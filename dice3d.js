/* True 3D dice: a CSS cube with pip faces. Isolated here so app.js just calls
   mount()/setFace()/roll(). The numeric glyph in #diceChar stays as the
   reduced-motion / screen-reader fallback. */

/* Cube rotation that brings each face value to the front. */
const FACE_ROT = {
  1: [0, 0],
  2: [90, 0],
  3: [0, -90],
  4: [0, 90],
  5: [-90, 0],
  6: [0, -180]
};

/* Where each face sits on the cube (translateZ pushed out by --die-half). */
const FACE_PLACE = {
  1: "translateZ(var(--die-half))",
  6: "rotateY(180deg) translateZ(var(--die-half))",
  3: "rotateY(90deg) translateZ(var(--die-half))",
  4: "rotateY(-90deg) translateZ(var(--die-half))",
  5: "rotateX(90deg) translateZ(var(--die-half))",
  2: "rotateX(-90deg) translateZ(var(--die-half))"
};

/* Pip layout on a 3x3 grid (cells 1..9). */
const PIPS = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9]
};

let cube = null;
let spins = 0;

export function mount(cubeEl) {
  if (!cubeEl) return;
  cube = cubeEl;
  cube.innerHTML = "";
  for (let v = 1; v <= 6; v++) {
    const face = document.createElement("div");
    face.className = "die-face die-face-" + v;
    face.style.transform = FACE_PLACE[v];
    for (let i = 1; i <= 9; i++) {
      const cell = document.createElement("span");
      cell.className = "die-pip-cell";
      if (PIPS[v].indexOf(i) >= 0) {
        const pip = document.createElement("span");
        pip.className = "die-pip";
        cell.appendChild(pip);
      }
      face.appendChild(cell);
    }
    cube.appendChild(face);
  }
  setFace(1);
}

export function setFace(value) {
  if (!cube) return;
  const r = FACE_ROT[value] || FACE_ROT[1];
  cube.style.transition = "none";
  cube.style.transform = "rotateX(" + r[0] + "deg) rotateY(" + r[1] + "deg)";
}

export function roll(value) {
  if (!cube) return;
  const r = FACE_ROT[value] || FACE_ROT[1];
  spins += 1;
  const extra = 720 + (spins % 2) * 360;
  cube.style.transition = "transform 0.62s cubic-bezier(0.2, 0.9, 0.25, 1)";
  cube.style.transform = "rotateX(" + (r[0] + extra) + "deg) rotateY(" + (r[1] + extra) + "deg)";
}
