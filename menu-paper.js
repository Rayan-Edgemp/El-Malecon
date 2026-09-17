/* A single, shared-vertex paper surface. No separate DOM slices or texture seams. */
(() => {
  const PAGE_HEIGHT = 28 / 17;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const smooth = (value) => value * value * (3 - 2 * value);
  const rendererURL = typeof document !== "undefined" ? document.currentScript.src : "";
  let localTextureSources;
  const localTextureImages = new Map();
  // A small area light gives the lifted paper a soft, height-dependent shadow.
  const SHADOW_SAMPLES = [[0, 0], [.9, 0], [-.9, 0], [.45, .78], [-.45, .78], [.45, -.78], [-.45, -.78]];
  const CURL_SHADOW_STRENGTH = .34;
  // Lower light angle: a clear cast shadow like a lifted menu in sunlight.
  // These distances are multiplied by each vertex's actual height, so the
  // shadow stays curved and pinned to the paper where it touches the surface.
  const CURL_SHADOW_REACH = [1.35, .32];

  function paperPoint(u, v, progress) {
    const y = (v - .5) * PAGE_HEIGHT;
    if (progress <= 0) return [u, y, 0];
    if (progress >= 1) return [-u, y, 0];
    const turn = smooth(progress);
    const lift = Math.sin(Math.PI * turn);
    // The lower outer corner leads. The diagonal fold straightens as it settles.
    const diagonal = .29 * Math.pow(lift, .85);
    const nx = Math.cos(diagonal);
    const ny = Math.sin(diagonal);
    // Keep the entire bound edge on the table throughout the turn.
    const fold = ny * PAGE_HEIGHT / 2 + nx * (1 - turn);
    const distance = nx * u + ny * y - fold;
    if (distance <= 0) return [u, y, 0];
    const alongFold = -ny * u + nx * y;
    // A changing radius along the fold gives the free corner a softer curl.
    const radius = .135 * Math.pow(lift, .8) * (1 - .28 * alongFold / PAGE_HEIGHT);
    const arcLength = Math.PI * radius;
    let across;
    let z;
    if (distance < arcLength) {
      const angle = distance / radius;
      across = radius * Math.sin(angle);
      z = radius * (1 - Math.cos(angle));
    } else {
      across = arcLength - distance;
      z = 2 * radius;
    }
    return [u + (across - distance) * nx, y + (across - distance) * ny, z];
  }

  async function fileTextures(pageIndexes) {
    if (!localTextureSources) {
      localTextureSources = new Promise((resolve, reject) => {
        // Plain scripts work for a double-clicked file:// page; fetch/module
        // requests and file-backed WebGL textures are blocked by browser CORS.
        const script = document.createElement("script");
        script.src = new URL("assets/menu/paper-textures.js", rendererURL).href;
        script.onload = () => {
          script.remove();
          const sources = window.elMaleconPaperTextures;
          if (sources && typeof sources === "object") resolve(sources);
          else reject(new Error("Menu textures unavailable"));
        };
        script.onerror = () => { script.remove(); reject(new Error("Menu textures unavailable")); };
        document.head.appendChild(script);
      }).catch((error) => { localTextureSources = null; throw error; });
    }
    const sources = await localTextureSources;
    // Decode just this turn's two faces. Reuse each decoded page on later turns.
    return Promise.all(pageIndexes.map((index) => {
      if (!localTextureImages.has(index)) {
        const ready = (async () => {
          const source = sources[index];
          if (typeof source !== "string") throw new Error("Menu page texture unavailable");
          const image = new Image();
          image.src = source;
          await image.decode();
          return image;
        })().catch((error) => { localTextureImages.delete(index); throw error; });
        localTextureImages.set(index, ready);
      }
      return localTextureImages.get(index);
    }));
  }

  class MenuPaper {
    static async create(stage, images, onLost, pageIndexes = [0, 1]) {
      const textures = location.protocol === "file:" ? await fileTextures(pageIndexes) : images;
      return new MenuPaper(stage, textures, onLost);
    }

    constructor(stage, images, onLost) {
      this.stage = stage;
      this.canvas = document.createElement("canvas");
      this.canvas.className = "menu-book-canvas";
      this.canvas.setAttribute("aria-hidden", "true");
      const gl = this.canvas.getContext("webgl", {
        alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: false
      });
      if (!gl) throw new Error("WebGL unavailable");
      this.gl = gl;
      this.canvas.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        onLost();
      });
      this.textures = [];
      this.textureSizes = [];
      this.textureSources = [];
      try {
        this.program = this.makeProgram();
        gl.useProgram(this.program);
        this.uniforms = Object.fromEntries(["viewport", "origin", "padding", "front", "back", "shadow", "shadowOffset", "shadowAlpha", "shadowReach", "pageWidth"]
          .map((name) => [name, gl.getUniformLocation(this.program, `u_${name}`)]));
        this.columns = 112;
        this.rows = 84;
        this.data = new Float32Array((this.columns + 1) * (this.rows + 1) * 8);
        const indices = [];
        for (let row = 0; row < this.rows; row += 1) {
          for (let column = 0; column < this.columns; column += 1) {
            const a = row * (this.columns + 1) + column;
            const b = a + this.columns + 1;
            indices.push(a, b, a + 1, a + 1, b, b + 1);
          }
        }
        this.indexCount = indices.length;
        this.vertices = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertices);
        gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
        [["a_position", 3, 0], ["a_normal", 3, 12], ["a_uv", 2, 24]].forEach(([name, size, offset]) => {
          const attribute = gl.getAttribLocation(this.program, name);
          gl.enableVertexAttribArray(attribute);
          gl.vertexAttribPointer(attribute, size, gl.FLOAT, false, 32, offset);
        });
        this.indices = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indices);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
        images.forEach((image, index) => {
          const texture = gl.createTexture();
          this.textures.push(texture);
          gl.activeTexture(gl.TEXTURE0 + index);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
          let source = image;
          if (Math.max(image.width, image.height) > maxSize) {
            source = document.createElement("canvas");
            const scale = maxSize / Math.max(image.width, image.height);
            source.width = Math.round(image.width * scale);
            source.height = Math.round(image.height * scale);
            source.getContext("2d").drawImage(image, 0, 0, source.width, source.height);
          }
          // UV v=0 is the top of the sheet, matching the image's first row.
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
          this.textureSources[index] = source;
          this.textureSizes[index] = [source.width, source.height];
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        });
        gl.uniform1i(this.uniforms.front, 0);
        gl.uniform1i(this.uniforms.back, 1);
        gl.uniform2f(this.uniforms.shadowReach, ...CURL_SHADOW_REACH);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.CULL_FACE);
        gl.clearColor(0, 0, 0, 0);
        if (gl.getError() !== gl.NO_ERROR) throw new Error("Menu paper initialization failed");
        stage.appendChild(this.canvas);
      } catch (error) {
        this.dispose();
        throw error;
      }
    }

    makeProgram() {
      const gl = this.gl;
      const sources = [
        [gl.VERTEX_SHADER, `
          attribute vec3 a_position;
          attribute vec3 a_normal;
          attribute vec2 a_uv;
          uniform vec2 u_viewport;
          uniform vec2 u_origin;
          uniform vec2 u_padding;
          uniform bool u_shadow;
          uniform vec2 u_shadowOffset;
          uniform mediump vec2 u_shadowReach;
          uniform float u_pageWidth;
          varying vec2 v_uv;
          varying vec3 v_normal;
          varying float v_height;
          void main() {
            vec3 position = a_position;
            v_height = position.z / u_pageWidth;
            if (u_shadow) {
              // Project the actual curved sheet onto the page/table underneath.
              // The penumbra broadens with lift and tightens at the contact edge.
              position.xy += position.z * u_shadowReach
                + u_shadowOffset * (u_pageWidth * .002 + position.z * .08);
              position.z = 0.0;
            }
            float w = 1.0 - position.z / 2200.0;
            vec2 center = u_origin + u_padding - u_viewport * .5;
            vec2 point = (position.xy - u_origin + center * w) / (u_viewport * .5);
            gl_Position = vec4(point.x, -point.y, -position.z / 2200.0, w);
            v_uv = a_uv;
            v_normal = a_normal;
          }
        `],
        [gl.FRAGMENT_SHADER, `
          precision mediump float;
          uniform sampler2D u_front;
          uniform sampler2D u_back;
          uniform bool u_shadow;
          uniform float u_shadowAlpha;
          uniform mediump vec2 u_shadowReach;
          varying vec2 v_uv;
          varying vec3 v_normal;
          varying float v_height;
          void main() {
            if (u_shadow) {
              if (v_height < .001) discard;
              float alpha = u_shadowAlpha * smoothstep(.001, .014, v_height);
              gl_FragColor = vec4(vec3(.035, .065, .065) * alpha, alpha);
              return;
            }
            vec4 ink;
            vec3 normal = normalize(v_normal);
            if (gl_FrontFacing) {
              ink = texture2D(u_front, v_uv);
            } else {
              ink = texture2D(u_back, vec2(1.0 - v_uv.x, v_uv.y));
              normal = -normal;
            }
            vec3 light = normalize(vec3(-u_shadowReach, 1.0));
            float shade = min(1.025, .74 + .26 * max(dot(normal, light), 0.0) / light.z);
            // A soft crease shadow adds depth without darkening the flat artwork.
            shade *= 1.0 - .10 * (1.0 - abs(normal.z));
            gl_FragColor = vec4(ink.rgb * shade, ink.a);
          }
        `]
      ];
      const shaders = sources.map(([type, source]) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          const message = gl.getShaderInfoLog(shader);
          gl.deleteShader(shader);
          throw new Error(message);
        }
        return shader;
      });
      const program = gl.createProgram();
      shaders.forEach((shader) => gl.attachShader(program, shader));
      gl.linkProgram(program);
      shaders.forEach((shader) => gl.deleteShader(shader));
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(message);
      }
      return program;
    }

    resize() {
      this.width = this.stage.clientWidth;
      this.height = this.stage.clientHeight;
      this.padX = this.width * .18;
      this.padY = this.height * .18;
      const width = this.width + this.padX * 2;
      const height = this.height + this.padY * 2;
      const limit = this.gl.getParameter(this.gl.MAX_RENDERBUFFER_SIZE);
      const ratio = Math.min(window.devicePixelRatio || 1, 2, limit / width, limit / height);
      this.canvas.width = Math.round(width * ratio);
      this.canvas.height = Math.round(height * ratio);
      this.canvas.style.cssText = `left:${-this.padX}px;top:${-this.padY}px;width:${width}px;height:${height}px;`;
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.gl.uniform2f(this.uniforms.viewport, width, height);
      this.gl.uniform2f(this.uniforms.origin, this.width * .5, this.height * .45);
      this.gl.uniform2f(this.uniforms.padding, this.padX, this.padY);
      this.gl.uniform1f(this.uniforms.pageWidth, this.width / 2);
    }

    setFaceSource(index, source) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[index]);
      const [width, height] = this.textureSizes[index];
      if (width === source.width && height === source.height) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        this.textureSizes[index] = [source.width, source.height];
      }
    }

    restoreFace(index) { this.setFaceSource(index, this.textureSources[index]); }

    draw(progress, offset) {
      const gl = this.gl;
      if (gl.isContextLost()) throw new Error("Menu paper context lost");
      const pageWidth = this.width / 2;
      const stride = this.columns + 1;
      const data = this.data;
      let rightExtent = 0;
      for (let row = 0; row <= this.rows; row += 1) {
        for (let column = 0; column <= this.columns; column += 1) {
          const u = column / this.columns;
          const v = row / this.rows;
          const point = paperPoint(u, v, progress);
          const i = (row * stride + column) * 8;
          data[i] = pageWidth + offset + point[0] * pageWidth;
          data[i + 1] = this.height * .5 + point[1] * pageWidth;
          data[i + 2] = point[2] * pageWidth;
          data[i + 6] = u;
          data[i + 7] = v;
          rightExtent = Math.max(rightExtent, point[0]);
        }
      }
      // Shared, smoothly interpolated normals prevent faceted lighting at edges.
      for (let row = 0; row <= this.rows; row += 1) {
        for (let column = 0; column <= this.columns; column += 1) {
          const i = (row * stride + column) * 8;
          const a = (row * stride + Math.max(0, column - 1)) * 8;
          const b = (row * stride + Math.min(this.columns, column + 1)) * 8;
          const c = (Math.max(0, row - 1) * stride + column) * 8;
          const d = (Math.min(this.rows, row + 1) * stride + column) * 8;
          const dx = data[b] - data[a], dy = data[b + 1] - data[a + 1], dz = data[b + 2] - data[a + 2];
          const ex = data[d] - data[c], ey = data[d + 1] - data[c + 1], ez = data[d + 2] - data[c + 2];
          const nx = dy * ez - dz * ey, ny = dz * ex - dx * ez, nz = dx * ey - dy * ex;
          const length = Math.hypot(nx, ny, nz) || 1;
          data[i + 3] = nx / length;
          data[i + 4] = ny / length;
          data[i + 5] = nz / length;
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertices);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (progress > 0 && progress < 1) {
        gl.uniform1i(this.uniforms.shadow, 1);
        gl.uniform1f(this.uniforms.shadowAlpha, 1 - Math.pow(1 - CURL_SHADOW_STRENGTH, 1 / SHADOW_SAMPLES.length));
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        // All projected triangles share a depth. LESS admits just one triangle
        // at a pixel per light sample, so a folded-over sheet cannot double-darken it.
        gl.depthFunc(gl.LESS);
        for (const [x, y] of SHADOW_SAMPLES) {
          gl.clear(gl.DEPTH_BUFFER_BIT);
          gl.uniform2f(this.uniforms.shadowOffset, x, y);
          gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
        }
        gl.disable(gl.BLEND);
        gl.depthFunc(gl.LEQUAL);
        gl.clear(gl.DEPTH_BUFFER_BIT);
      }
      gl.uniform1i(this.uniforms.shadow, 0);
      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
      return clamp(rightExtent, 0, 1);
    }

    clear() {
      this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
    }

    dispose() {
      this.canvas.remove();
      this.textures.forEach((texture) => this.gl.deleteTexture(texture));
      if (this.vertices) this.gl.deleteBuffer(this.vertices);
      if (this.indices) this.gl.deleteBuffer(this.indices);
      if (this.program) this.gl.deleteProgram(this.program);
    }
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { paperPoint };
  else window.ElMaleconPaper = MenuPaper;
})();
