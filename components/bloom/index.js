// Adapted from spidersharma UnrealBloomPass
var LuminosityHighPassShader = require('../../lib/shaders/LuminosityHighPassShader');

var BlurDirectionX = new THREE.Vector2( 1.0, 0.0 );
var BlurDirectionY = new THREE.Vector2( 0.0, 1.0 );

AFRAME.registerComponent("bloom", {
    schema: {
        strength: { default: 1 },
        radius: { default: 0.4 },
        threshold: { default: 0.8 },
		filter: { default: "" }
    },

    init: function () {
        this.system = this.el.sceneEl.systems.effects;
        var pars = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat };
        this.renderTargetsHorizontal = [];
        this.renderTargetsVertical = [];
        this.nMips = 5;
        
        this.renderTargetBright = new THREE.WebGLRenderTarget( 1, 1, pars );
        this.renderTargetBright.texture.name = "UnrealBloomPass.bright";
        this.renderTargetBright.texture.generateMipmaps = false;

        for( var i=0; i<this.nMips; i++) {

            var renderTarget = new THREE.WebGLRenderTarget( 1, 1, pars );

            renderTarget.texture.name = "UnrealBloomPass.h" + i;
            renderTarget.texture.generateMipmaps = false;

            this.renderTargetsHorizontal.push(renderTarget);

            var renderTarget = new THREE.WebGLRenderTarget( 1, 1, pars );

            renderTarget.texture.name = "UnrealBloomPass.v" + i;
            renderTarget.texture.generateMipmaps = false;

            this.renderTargetsVertical.push(renderTarget);

        }

        // luminosity high pass material

        var highPassShader = LuminosityHighPassShader;
        this.highPassUniforms = THREE.UniformsUtils.clone( highPassShader.uniforms );

        this.highPassUniforms[ "smoothWidth" ].value = 0.01;

        this._materialHighPassFilter = this.system.materialize(highPassShader, this.highPassUniforms); 
		this.materialHighPassFilter = this._materialHighPassFilter;
        // Gaussian Blur Materials
        this.separableBlurMaterials = [];
        var kernelSizeArray = [3, 5, 7, 9, 11];
        
        for( var i=0; i<this.nMips; i++) {

            this.separableBlurMaterials.push(this.getSeperableBlurMaterial(kernelSizeArray[i]));

            this.separableBlurMaterials[i].uniforms[ "texSize" ].value = new THREE.Vector2(1, 1);

        }

        // Composite material
        this.compositeMaterial = this.getCompositeMaterial(this.nMips);
        this.compositeMaterial.uniforms["blurTexture1"].value = this.renderTargetsVertical[0].texture;
        this.compositeMaterial.uniforms["blurTexture2"].value = this.renderTargetsVertical[1].texture;
        this.compositeMaterial.uniforms["blurTexture3"].value = this.renderTargetsVertical[2].texture;
        this.compositeMaterial.uniforms["blurTexture4"].value = this.renderTargetsVertical[3].texture;
        this.compositeMaterial.uniforms["blurTexture5"].value = this.renderTargetsVertical[4].texture;
        this.compositeMaterial.needsUpdate = true;

        var bloomFactors = [1.0, 0.8, 0.6, 0.4, 0.2];
        this.compositeMaterial.uniforms["bloomFactors"].value = bloomFactors;
        this.bloomTintColors = [new THREE.Vector3(1,1,1), new THREE.Vector3(1,1,1), new THREE.Vector3(1,1,1)
                                                    ,new THREE.Vector3(1,1,1), new THREE.Vector3(1,1,1)];
        this.compositeMaterial.uniforms["bloomTintColors"].value = this.bloomTintColors;
		this.oldClearColor = new THREE.Color();
        this.uniforms = {
            "texture": { type: "t", value: this.renderTargetsHorizontal[0] }
        }
        this.needsResize = true;
        this.system.register(this);
    },
	update: function (oldData) {
		if (oldData.filter !== this.data.filter) {
			if (this._materialHighPassFilter !== this.materialHighPassFilter) {
				this.materialHighPassFilter.dispose();
			}
			this.materialHighPassFilter = this.data.filter ? 
				this.system.fuse([this.data.filter]) : this._materialHighPassFilter;
		}
	},
    tock: function (time) {
        if (!this.system.isActive(this, true)) return;
		var scene = this.el.sceneEl;
		var renderer = scene.renderer;
        var readBuffer = scene.renderTarget;
        this.oldClearColor.copy( renderer.getClearColor() );
		this.oldClearAlpha = renderer.getClearAlpha();
		var oldAutoClear = renderer.autoClear;
		renderer.autoClear = false;

		renderer.setClearColor( new THREE.Color( 0, 0, 0 ), 0 );

		// 1. Extract Bright Areas
		this.highPassUniforms[ "tDiffuse" ].value = readBuffer.texture;
		this.highPassUniforms[ "luminosityThreshold" ].value = this.data.threshold;
		this.system.renderPass(this.materialHighPassFilter, this.renderTargetBright, null, true);

		// 2. Blur All the mips progressively
		var inputRenderTarget = this.renderTargetBright;

		var fn = function(material, camera, bounds) {
			material.uniforms.uvrb.value.fromArray(bounds);
		};

		for(var i=0; i<this.nMips; i++) {
	
			this.separableBlurMaterials[i].uniforms[ "colorTexture" ].value = inputRenderTarget.texture;

			this.separableBlurMaterials[i].uniforms[ "direction" ].value = BlurDirectionX;

            this.system.renderPass(this.separableBlurMaterials[i], this.renderTargetsHorizontal[i], fn);

			this.separableBlurMaterials[i].uniforms[ "colorTexture" ].value = this.renderTargetsHorizontal[i].texture;

			this.separableBlurMaterials[i].uniforms[ "direction" ].value = BlurDirectionY;

			this.system.renderPass(this.separableBlurMaterials[i], this.renderTargetsVertical[i], fn);

			inputRenderTarget = this.renderTargetsVertical[i];
		}

		// Composite All the mips
		this.compositeMaterial.uniforms["bloomStrength"].value = this.data.strength;
		this.compositeMaterial.uniforms["bloomRadius"].value = this.data.radius;
		this.compositeMaterial.uniforms["bloomTintColors"].value = this.bloomTintColors;
        this.system.renderPass(this.compositeMaterial, this.renderTargetsHorizontal[0], null);

		renderer.setClearColor( this.oldClearColor, this.oldClearAlpha );
		renderer.autoClear = oldAutoClear;
	},

    setSize: function ( width, height ) {

		var resx = Math.round(width/2);
		var resy = Math.round(height/2);

		this.renderTargetBright.setSize(resx, resy);

		for( var i=0; i<this.nMips; i++) {

			this.renderTargetsHorizontal[i].setSize(resx, resy);
			this.renderTargetsVertical[i].setSize(resx, resy);

			this.separableBlurMaterials[i].uniforms[ "texSize" ].value = new THREE.Vector2(resx, resy);

			resx = Math.round(resx/2);
			resy = Math.round(resy/2);
		}
	},

    remove: function () {
        this.system.unregister(this);
        for( var i=0; i< this.renderTargetsHorizontal.length(); i++) {
			this.renderTargetsHorizontal[i].dispose();
		}
		for( var i=0; i< this.renderTargetsVertical.length(); i++) {
			this.renderTargetsVertical[i].dispose();
		}
		this.renderTargetBright.dispose();
    },

    getSeperableBlurMaterial: function(kernelRadius) {

		return new THREE.ShaderMaterial( {

			defines: {
				"KERNEL_RADIUS" : kernelRadius,
				"SIGMA" : kernelRadius
			},

			uniforms: {
				"colorTexture": { value: null },
				"texSize": 				{ value: new THREE.Vector2( 0.5, 0.5 ) },
				"direction": 				{ value: new THREE.Vector2( 0.5, 0.5 ) },
				"uvrb": { value: new THREE.Vector4()}
			},

			vertexShader:
				"varying vec2 vUv;\n\
				void main() {\n\
					vUv = uv;\n\
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );\n\
				}",

			fragmentShader:
				"#include <common>\
				varying vec2 vUv;\n\
				uniform sampler2D colorTexture;\n\
				uniform vec2 texSize;\
				uniform vec2 direction;\
				uniform vec4 uvrb;\
				vec2 uvr(vec2 uv) { return vec2(clamp(uv.x * uvrb.x + uvrb.y, uvrb.z, uvrb.w), uv.y); }\
				\
				float gaussianPdf(in float x, in float sigma) {\
					return 0.39894 * exp( -0.5 * x * x/( sigma * sigma))/sigma;\
				}\
				void main() {\n\
					vec2 invSize = 1.0 / texSize;\
					float fSigma = float(SIGMA);\
					float weightSum = gaussianPdf(0.0, fSigma);\
					vec3 diffuseSum = texture2D( colorTexture, uvr(vUv)).rgb * weightSum;\
					for( int i = 1; i < KERNEL_RADIUS; i ++ ) {\
						float x = float(i);\
						float w = gaussianPdf(x, fSigma);\
						vec2 uvOffset = direction * invSize * x;\
						vec3 sample1 = texture2D( colorTexture, uvr(vUv + uvOffset)).rgb;\
						vec3 sample2 = texture2D( colorTexture, uvr(vUv - uvOffset)).rgb;\
						diffuseSum += (sample1 + sample2) * w;\
						weightSum += 2.0 * w;\
					}\
					gl_FragColor = vec4(diffuseSum/weightSum, 1.0);\n\
				}"
		} );
	},

	getCompositeMaterial: function(nMips) {

		return new THREE.ShaderMaterial( {

			defines:{
				"NUM_MIPS" : nMips
			},

			uniforms: {
				"blurTexture1": { value: null },
				"blurTexture2": { value: null },
				"blurTexture3": { value: null },
				"blurTexture4": { value: null },
				"blurTexture5": { value: null },
				"bloomStrength" : { value: 1.0 },
				"bloomFactors" : { value: null },
				"bloomTintColors" : { value: null },
				"bloomRadius" : { value: 0.0 }
			},

			vertexShader:
				"varying vec2 vUv;\n\
				void main() {\n\
					vUv = uv;\n\
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );\n\
				}",

			fragmentShader:
				"varying vec2 vUv;\
				uniform sampler2D blurTexture1;\
				uniform sampler2D blurTexture2;\
				uniform sampler2D blurTexture3;\
				uniform sampler2D blurTexture4;\
				uniform sampler2D blurTexture5;\
				uniform float bloomStrength;\
				uniform float bloomRadius;\
				uniform float bloomFactors[NUM_MIPS];\
				uniform vec3 bloomTintColors[NUM_MIPS];\
				\
				float lerpBloomFactor(const in float factor) { \
					float mirrorFactor = 1.2 - factor;\
					return mix(factor, mirrorFactor, bloomRadius);\
				}\
				\
				void main() {\
					gl_FragColor = bloomStrength * ( lerpBloomFactor(bloomFactors[0]) * vec4(bloomTintColors[0], 1.0) * texture2D(blurTexture1, vUv) + \
					 							 lerpBloomFactor(bloomFactors[1]) * vec4(bloomTintColors[1], 1.0) * texture2D(blurTexture2, vUv) + \
												 lerpBloomFactor(bloomFactors[2]) * vec4(bloomTintColors[2], 1.0) * texture2D(blurTexture3, vUv) + \
												 lerpBloomFactor(bloomFactors[3]) * vec4(bloomTintColors[3], 1.0) * texture2D(blurTexture4, vUv) + \
												 lerpBloomFactor(bloomFactors[4]) * vec4(bloomTintColors[4], 1.0) * texture2D(blurTexture5, vUv) );\
				}"
		} );
	},

	diffuse: true,

    fragment: [
        "void $main(inout vec4 color, vec4 origColor, vec2 uv, float depth){",
        "   color.rgb += texture2D($texture, uv).rgb;",
        "}"
    ].join("\n")

});