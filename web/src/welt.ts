// Hauswelt: Szene, Licht, Hausmodell aus dem Planer (GLB) und Physik (Rapier, Kollision = ganzes Haus)
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import RAPIER from "@dimforge/rapier3d-compat";

export type Qualitaet = "niedrig" | "mittel" | "hoch";

export interface WeltDaten {
  modell_version: number;
  geschosse: { EG: number; OG: number };
  start: { pos: number[]; ziel: number[] };
  raeume: { id: string; name: string; geschoss: string; polygon: [number, number][] }[];
  moebel: { id: string; typ: string; name: string; raum?: string; geschoss: string; pos: [number, number]; masse_bth: [number, number, number]; rot_grad: number; z: number }[];
}

let rapierBereit: Promise<void> | null = null;
export const rapierLaden = () => (rapierBereit ??= RAPIER.init());

export class Welt {
  renderer: THREE.WebGLRenderer;
  szene = new THREE.Scene();
  kamera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
  physik!: RAPIER.World;
  haus = new THREE.Group();
  daten!: WeltDaten;
  sonne = new THREE.DirectionalLight(0xfff0dc, 2.4);
  himmel = new THREE.HemisphereLight(0xdfeaff, 0x6b5a45, 0.7);
  lampe = new THREE.SpotLight(0xfff2d8, 0, 22, 0.42, 0.55, 1.2);
  nacht = false;
  /** Schnitt von oben (Kamera „oben“): alles über dieser Höhe wird ausgeblendet */
  schnitt = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
  private uhr = new THREE.Clock();
  private wiese!: THREE.Mesh;
  private schleifen = new Set<(dt: number) => void>();
  private envTex: THREE.Texture;
  laeuft = false;

  constructor(private behaelter: HTMLElement, public qualitaet: Qualitaet) {
    this.renderer = new THREE.WebGLRenderer({ antialias: qualitaet !== "niedrig", powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, qualitaet === "hoch" ? 2 : qualitaet === "mittel" ? 1.5 : 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = qualitaet !== "niedrig";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.clippingPlanes = [this.schnitt];
    behaelter.appendChild(this.renderer.domElement);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.szene.environment = this.envTex;
    this.szene.environmentIntensity = 0.55;
    this.szene.background = new THREE.Color(0xbfd6e8);
    this.szene.fog = new THREE.Fog(0xbfd6e8, 40, 140);
    this.sonne.position.set(14, 18, 22);
    this.sonne.target.position.set(3.9, 0, 5.5);
    this.sonne.castShadow = qualitaet !== "niedrig";
    this.sonne.shadow.mapSize.set(qualitaet === "hoch" ? 4096 : 2048, qualitaet === "hoch" ? 4096 : 2048);
    const sc = this.sonne.shadow.camera;
    sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 70;
    this.sonne.shadow.bias = -0.0004;
    this.sonne.shadow.normalBias = 0.02;
    this.szene.add(this.sonne, this.sonne.target, this.himmel, this.haus);
    // Taschenlampe (Nacht): hängt an der Kamera
    this.lampe.castShadow = qualitaet === "hoch";
    this.kamera.add(this.lampe, this.lampe.target);
    this.lampe.position.set(0.15, -0.15, 0);
    this.lampe.target.position.set(0, -0.1, -1);
    this.szene.add(this.kamera);
    // Wiese rund ums Haus
    // (nur für ältere Hauswelten ohne Gelände; neuere bringen Gelände und Außenanlage aus dem Planer mit)
    const wiese = new THREE.Mesh(new THREE.CircleGeometry(120, 48), new THREE.MeshStandardMaterial({ color: 0x5f7a3e, roughness: 1 }));
    wiese.rotation.x = -Math.PI / 2;
    wiese.position.set(3.9, -0.06, 5.5);
    wiese.receiveShadow = true;
    this.wiese = wiese;
    this.szene.add(wiese);
    new ResizeObserver(() => this.groesse()).observe(behaelter);
    this.groesse();
  }

  private groesse() {
    const w = this.behaelter.clientWidth || innerWidth, h = this.behaelter.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    this.kamera.aspect = w / h;
    this.kamera.updateProjectionMatrix();
  }

  async laden(fortschritt: (anteil: number) => void) {
    await rapierLaden();
    const [gltf, daten] = await Promise.all([
      new GLTFLoader().loadAsync("/api/welt/haus.glb", (e) => e.total && fortschritt(e.loaded / e.total)),
      fetch("/api/welt/welt.json").then((r) => {
        if (!r.ok) throw new Error("Hauswelt fehlt – im Planer „Spielwelt übergeben“ drücken.");
        return r.json();
      }),
    ]);
    this.daten = daten;
    this.haus.clear();
    this.haus.add(gltf.scene);
    this.haus.updateMatrixWorld(true);
    let mitGelaende = false;
    gltf.scene.traverse((o) => { if (o.userData?.art === "gelaende" || o.name.startsWith("Gel")) mitGelaende = true; });
    this.wiese.visible = !mitGelaende;
    this.physik?.free();
    this.physik = new RAPIER.World({ x: 0, y: -18, z: 0 });
    // Kollision: alle Dreiecke des Hauses in einem Trimesh, dazu der Boden draußen
    const pos: number[] = [], idx: number[] = [];
    const v = new THREE.Vector3();
    this.haus.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const e = m.userData ?? {};
      if (e.art === "panorama") return; // Foto-Hintergrund: nicht anfassbar
      const glas = e.art === "glas" || (Array.isArray(m.material) ? false : (m.material as THREE.Material).transparent);
      m.castShadow = !glas && !e.keinSchatten;
      m.receiveShadow = true;
      const g = m.geometry as THREE.BufferGeometry;
      const p = g.getAttribute("position");
      if (!p) return;
      const basis = pos.length / 3;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
        pos.push(v.x, v.y, v.z);
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(basis + g.index.getX(i));
      else for (let i = 0; i < p.count; i++) idx.push(basis + i);
    });
    this.physik.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(idx)));
    // Boden draußen: bei mitgeliefertem Gelände nur als Fangnetz tief unten
    this.physik.createCollider(RAPIER.ColliderDesc.cuboid(300, 0.05, 300).setTranslation(3.9, mitGelaende ? -30 : -0.11, 5.5));
    // Strahl-Abfragen (Verstecke, Kamera) brauchen die Kollision schon vor dem ersten Bild
    this.physik.step();
    this.tageszeit(false);
  }

  tageszeit(nacht: boolean) {
    this.nacht = nacht;
    this.sonne.visible = !nacht;
    this.himmel.intensity = nacht ? 0.06 : 0.7;
    this.szene.environmentIntensity = nacht ? 0.03 : 0.55;
    const c = new THREE.Color(nacht ? 0x0b1020 : 0xbfd6e8);
    this.szene.background = c;
    (this.szene.fog as THREE.Fog).color = c;
    this.lampe.intensity = nacht ? 40 : 0;
  }

  /** Strahl gegen die Hauskollision; liefert Trefferpunkt und Normale */
  strahl(von: THREE.Vector3, richtung: THREE.Vector3, max: number, ohne?: RAPIER.Collider): { punkt: THREE.Vector3; normale: THREE.Vector3; abstand: number } | null {
    const r = new RAPIER.Ray(von, richtung);
    const t = this.physik.castRayAndGetNormal(r, max, true, undefined, undefined, ohne);
    if (!t) return null;
    const p = r.pointAt(t.timeOfImpact);
    return { punkt: new THREE.Vector3(p.x, p.y, p.z), normale: new THREE.Vector3(t.normal.x, t.normal.y, t.normal.z), abstand: t.timeOfImpact };
  }

  schleife(fn: (dt: number) => void) {
    this.schleifen.add(fn);
    return () => this.schleifen.delete(fn);
  }

  start() {
    if (this.laeuft) return;
    this.laeuft = true;
    this.uhr.getDelta();
    const bild = () => {
      if (!this.laeuft) return;
      requestAnimationFrame(bild);
      const dt = Math.min(0.05, this.uhr.getDelta());
      for (const f of this.schleifen) f(dt);
      this.physik?.step();
      this.renderer.render(this.szene, this.kamera);
    };
    requestAnimationFrame(bild);
  }

  stopp() {
    this.laeuft = false;
  }
}
