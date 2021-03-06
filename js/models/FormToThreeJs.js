PP64.ns("utils");

// Converts extracted FORM data into a Three.js scene.
PP64.utils.FormToThreeJs = class FormToThreeJs {
  constructor() {
    this.bgColor = 0x000000;
    this.showTextures = true;
    this.showWireframe = false;
    this.showVertexNormals = false;
    this.useFormCamera = false;
  }

  createModel(form) {
    const materials = this._parseMaterials(form);
    return this._parseForm(form, materials);
  }

  _parseForm(form, materials) {
    const childObjs = this._parseFormObj(form, materials, 0);
    if (childObjs.length !== 1)
      console.warn(`Expected 1 return object from _parseForm, got ${childObjs.length}`);
    return childObjs[0];
  }

  _parseFormObj(form, materials, objIndex) {
    let objs = PP64.utils.FORM.getByGlobalIndex(form, "OBJ1", objIndex);
    if (objs === null) {
      if (objIndex === 0) { // mp2 62/2 doesn't have 0 obj?
        objs = form.OBJ1[0].parsed.objects[0];
        console.warn("Using first object rather than global index 0 object");
      }

      if (!objs)
        throw `Attempted to get unavailable OBJ ${objIndex}`;
    }

    if (!Array.isArray(objs)) {
      objs = [objs];
    }

    const newObjs = [];

    for (let o = 0; o < objs.length; o++) {
      const obj = objs[o];

      if (obj.objType === 0x3D) { // Just references other objects, can transform them.
        const newObj = this._createObject3DFromOBJ1Entry(obj);

        for (let i = 0; i < obj.children.length; i++) {
          const childObjs = this._parseFormObj(form, materials, obj.children[i]);
          if (childObjs && childObjs.length) {
            childObjs.forEach(childObj => {
              newObj.add(childObj);
            });
          }
        }

        newObjs.push(newObj);
      }
      else if (obj.objType === 0x10) { // References a SKL1, which will point back to other objects.
        const newObj = this._createObject3DFromOBJ1Entry(obj);

        const skl1GlobalIndex = obj.skeletonGlobalIndex;
        const sklObj = this._parseFormSkl(form, materials, skl1GlobalIndex);
        newObj.add(sklObj);

        newObjs.push(newObj);
      }
      else if (obj.objType === 0x3A) {
        const newObj = this._createObject3DFromOBJ1Entry(obj);

        const geometry = new THREE.Geometry();

        for (let f = obj.faceIndex; f < obj.faceIndex + obj.faceCount; f++) {
          const face = form.FAC1[0].parsed.faces[f];
          this._populateGeometryWithFace(form, geometry, face);
        }

        if (this.showTextures) {
          const textureMesh = new THREE.Mesh(geometry, materials);
          newObj.add(textureMesh);
        }

        if (this.showWireframe) {
          const wireframeMaterial = new THREE.LineBasicMaterial({
            color: PP64.utils.img.invertColor(this.bgColor),
            linewidth: this.showTexture ? 2 : 1
          });
          const wireframe = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), wireframeMaterial);
          newObj.add(wireframe);
        }

        if (this.showVertexNormals) {
          const normalsHelper = new THREE.VertexNormalsHelper(new THREE.Mesh(geometry, materials), 8, 0x00FF00, 1);
          newObj.add(normalsHelper);
        }

        newObjs.push(newObj);
      }
      // else if (obj.objType === 0x3E) {
      //   if ($$debug) {
      //     const newObj = new THREE.Object3D();
      //     const geometry = new THREE.Geometry();
      //     geometry.vertices.push(new THREE.Vector3(0, 0, 0));
      //     const dotMaterial = new THREE.PointsMaterial( { color: 0xFF0000, size: 40 } );
      //     const dot = new THREE.Points( geometry, dotMaterial );
      //     newObj.add(dot);
      //     newObjs.push(newObj);
      //   }
      // }
    }

    return newObjs;
  }

  _createObject3DFromOBJ1Entry(obj) {
    const newObj = new THREE.Object3D();

    // Name the nodes for animation - see MtnxToThreeJs
    if (obj.hasOwnProperty("globalIndex"))
      newObj.name = this._getObjNameFromId(obj.globalIndex);

    newObj.position.x = obj.posX;
    newObj.position.y = obj.posY;
    newObj.position.z = obj.posZ;

    newObj.rotation.x = $$number.degreesToRadians(obj.rotX);
    newObj.rotation.y = $$number.degreesToRadians(obj.rotY);
    newObj.rotation.z = $$number.degreesToRadians(obj.rotZ);
    newObj.rotation.order = "ZYX";

    newObj.scale.x = obj.scaleX;
    newObj.scale.y = obj.scaleY;
    newObj.scale.z = obj.scaleZ;

    return newObj;
  }

  _getObjNameFromId(id) {
    return $$hex(id);
  }

  _parseFormSkl(form, materials, skl1GlobalIndex) {
    const sklMatch = PP64.utils.FORM.getByGlobalIndex(form, "SKL1", skl1GlobalIndex);
    if (sklMatch === null || Array.isArray(sklMatch))
      throw "Unexpected SKL1 search result";

    return this._parseFormSklNode(form, materials, sklMatch.skls, 0);
  }

  _parseFormSklNode(form, materials, skls, index) {
    const skl = skls[index];
    const sklObj = this._createObject3DFromOBJ1Entry(skl);

    const objIndex = skl.objGlobalIndex;
    const childObjs = this._parseFormObj(form, materials, objIndex);
    if (childObjs && childObjs.length) {
      childObjs.forEach(childObj => {
        sklObj.add(childObj);
      });
    }

    if (skl.isParentNode) {
      let currentChildIndex = index + 1;
      while (currentChildIndex) {
        const childSkl = skls[currentChildIndex];
        const childSklObj = this._parseFormSklNode(form, materials, skls, currentChildIndex);
        sklObj.add(childSklObj);

        if (childSkl.nextSiblingRelativeIndex) {
          currentChildIndex += childSkl.nextSiblingRelativeIndex;
        }
        else {
          break;
        }
      }
    }

    return sklObj;
  }

  _populateGeometryWithFace(form, geometry, face) {
    if (!face.vtxEntries.length)
      return;

    const scale = form.VTX1[0].parsed.scale;

    const vtxEntries = face.vtxEntries;
    let vtxIndices = [];
    for (let i = 0; i < 3; i++) {
      const vtxEntry = vtxEntries[i];
      let vtx = form.VTX1[0].parsed.vertices[vtxEntry.vertexIndex];
      vtxIndices.push(geometry.vertices.length);
      geometry.vertices.push(this._makeVertex(vtx, scale));
    }
    if (vtxEntries.length === 4) {
      for (let i = 0; i < 4; i++) {
        if (i === 1) continue; // 0, 2, 3
        const vtxEntry = vtxEntries[i];
        let vtx = form.VTX1[0].parsed.vertices[vtxEntry.vertexIndex];
        vtxIndices.push(geometry.vertices.length);
        geometry.vertices.push(this._makeVertex(vtx, scale));
      }
    }

    if (vtxEntries.length === 3) {
      this._addFace(geometry, form, face,
        [vtxIndices[0], vtxIndices[1], vtxIndices[2]],
        [vtxEntries[0], vtxEntries[1], vtxEntries[2]]
      );
    }
    else if (vtxEntries.length === 4) {
      this._addFace(geometry, form, face,
        [vtxIndices[0], vtxIndices[1], vtxIndices[2]],
        [vtxEntries[0], vtxEntries[1], vtxEntries[2]]
      );

      this._addFace(geometry, form, face,
        [vtxIndices[3], vtxIndices[4], vtxIndices[5]],
        [vtxEntries[0], vtxEntries[2], vtxEntries[3]]
      );
    }
  }

  _addFace(geometry, form, face, indices, vtxEntries) {
    const tri = new THREE.Face3();
    tri.a = indices[0];
    tri.b = indices[1];
    tri.c = indices[2];
    tri.vertexNormals = this._makeVertexNormals(form, vtxEntries[0].vertexIndex, vtxEntries[1].vertexIndex, vtxEntries[2].vertexIndex);
    tri.materialIndex = this._getMaterialIndex(face);
    tri.color = new THREE.Color(this._getColorBytes(form, face));
    tri.vertexColors = this._makeVertexColors(form, face, vtxEntries[0], vtxEntries[1], vtxEntries[2]);

    geometry.faceVertexUvs[0].push(this._makeVertexUVs(vtxEntries[0], vtxEntries[1], vtxEntries[2]));
    geometry.faces.push(tri);
  }

  _parseMaterials(form) {
    const materials = [
      new THREE.MeshBasicMaterial({ vertexColors: THREE.VertexColors }),
      new THREE.MeshBasicMaterial({ vertexColors: THREE.FaceColors }),
    ];

    if (form.BMP1) {
      if (form.ATR1 && form.ATR1[0]) {
        const atrs = form.ATR1[0].parsed.atrs;
        for (let i = 0; i < atrs.length; i++) {
          const atr = atrs[i];
          const bmp = PP64.utils.FORM.getByGlobalIndex(form, "BMP1", atr.bmpGlobalIndex);
          if (bmp === null || Array.isArray(bmp)) {
            console.warn("Unexpected bitmap result from global index lookup");
            continue;
          }

          const textureMaterial = this._createTextureMaterial(atr, bmp);
          materials.push(textureMaterial);
        }
      }
      else {
        console.warn("BMPs, but no ATRs");
      }
    }

    return materials;
  }

  _createTextureMaterial(atr, bmp) {
    const dataUri = PP64.utils.arrays.arrayBufferToDataURL(bmp.src, bmp.width, bmp.height);
    $$log("Texture", dataUri);
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = "";
    const texture = loader.load(dataUri);
    texture.flipY = false;
    texture.wrapS = this._getWrappingBehavior(atr.xBehavior);
    texture.wrapT = this._getWrappingBehavior(atr.yBehavior);

    return new THREE.MeshBasicMaterial({
      alphaTest: 0.5,
      map: texture,
      transparent: true,
      vertexColors: THREE.VertexColors,
    });
  }

  _getWrappingBehavior(behavior) {
    switch (behavior) {
      case 0x2C:
        return THREE.MirroredRepeatWrapping;
      case 0x2D:
        return THREE.RepeatWrapping;
      case 0x2E:
        return THREE.ClampToEdgeWrapping; // default
      default:
        console.warn(`Unknown behavior ${$$hex(behavior)}`);
        return THREE.ClampToEdgeWrapping; // default
    }
  }

  _makeVertex(vtx, scale) {
    return new THREE.Vector3(
      (vtx.x * scale),
      (vtx.y * scale),
      (vtx.z * scale)
    );
  }

  _makeVertexNormals(form, vtxIndex1, vtxIndex2, vtxIndex3) {
    return [
      this._makeVertexNormal(form, vtxIndex1),
      this._makeVertexNormal(form, vtxIndex2),
      this._makeVertexNormal(form, vtxIndex3),
    ];
  }

  _makeVertexNormal(form, vtxIndex) {
    let vtx = form.VTX1[0].parsed.vertices[vtxIndex];
    return new THREE.Vector3(
      (vtx.normalX) / (127 + (vtx.normalX < 0 ? 1 : 0)),
      (vtx.normalY) / (127 + (vtx.normalY < 0 ? 1 : 0)),
      (vtx.normalZ) / (127 + (vtx.normalZ < 0 ? 1 : 0)),
    );
  }

  _makeVertexUVs(vtxEntry1, vtxEntry2, vtxEntry3) {
    return [
      this._makeVertexUV(vtxEntry1),
      this._makeVertexUV(vtxEntry2),
      this._makeVertexUV(vtxEntry3),
    ];
  }

  _makeVertexUV(vtxEntry) {
    return new THREE.Vector2(vtxEntry.u, vtxEntry.v);
  }

  _getMaterialIndex(face) {
    if (face.atrIndex >= 0 || face.mystery3 === 0x36) { // Face colors, or maybe bitmap
      // If it is 0xFFFF (-1) -> THREE.FaceColors material
      // If greater, it'll be a bitmap material
      return face.atrIndex + 2;
    }
    else if (face.mystery3 === 0x37) { // Vertex colors?
      return 0; // Vertex colors
    }
  }

  _getColorBytes(form, face) {
    if (face.mystery3 === 0x36) {
      const materialIndex = face.materialIndex;
      return this._getColorFromMaterial(form, materialIndex);
    }
    else if (face.mystery3 === 0x37) { // Vertex colors?
      return 0xFFFC00; // Puke green, shouldn't see this
    }

    console.warn("Could not determine color for face");
  }

  _getColorFromMaterial(form, materialIndex) {
    if (form.MAT1 && form.MAT1[0] && form.MAT1[0].parsed) {
      const colorIndex = form.MAT1[0].parsed.materials[materialIndex].colorIndex;
      if (form.COL1 && form.COL1[0] && form.COL1[0].parsed) {
        if (form.COL1[0].parsed.hasOwnProperty(colorIndex))
          return form.COL1[0].parsed[colorIndex] >>> 8;
      }
    }

    console.warn(`Could not find color ${colorIndex} specified by material ${materialIndex}`);
    return 0xFFFC00; // Puke green
  }

  _makeVertexColors(form, face, vtxEntry1, vtxEntry2, vtxEntry3) {
    if (face.mystery3 !== 0x37)
      return [];

    return [
      this._makeVertexColor(form, vtxEntry1),
      this._makeVertexColor(form, vtxEntry2),
      this._makeVertexColor(form, vtxEntry3),
    ];
  }

  _makeVertexColor(form, vtxEntry) {
    if (vtxEntry.materialIndex < 0)
      return null;
    return new THREE.Color(this._getColorFromMaterial(form, vtxEntry.materialIndex));
  }

  createCamera(form, width, height) {
    const camera = new THREE.PerspectiveCamera(75, width / height, 1, 999999);
    if (this.useFormCamera) {
      const cameraObjs = PP64.utils.FORM.getObjectsByType(form, 0x61);
      if (cameraObjs.length === 3) {
        const cameraEyeObj = cameraObjs[0];
        const cameraInterestObj = cameraObjs[1];
        camera.position.set(
          cameraEyeObj.posX,
          cameraEyeObj.posY,
          cameraEyeObj.posZ
        );
        camera.lookAt(new THREE.Vector3(
          cameraInterestObj.posX,
          cameraInterestObj.posY,
          cameraInterestObj.posZ)
        );
        return camera;
      }
      else {
        console.warn(`Unexpected camera object count: ${cameraObjs.length}`);
      }
    }

    camera.position.z = 500;
    return camera;
  }
};
