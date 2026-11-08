var AevenOverlayPage = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region ../../packages/experimental/browser-overlay/src/styles.ts
	/** Accent used for selection boxes and labels. */
	const ACCENT = "#0069FB";
	/** The cursor's glow colour, the reference's. */
	const CURSOR_GLOW = "#339cff";
	/**
	* The sprite's rendered size in CSS pixels.
	*
	* The source PNG is 46x48, so this is a clean 2x downsample on a Retina display
	* rather than a resample.
	*/
	const CURSOR_SPRITE = {
		width: 23,
		height: 24
	};
	/** Sprite origin relative to the cursor box, matching the reference artwork. */
	const CURSOR_NUDGE = {
		x: 12,
		y: -2.5
	};
	/**
	* The cursor's glow, matching the reference's two-stop drop shadow.
	*
	* A page cannot be assumed to define the glow variable, so a fallback is baked
	* into the filter. A host may override `--aeven-browser-overlay-glow` on the
	* overlay root to re-tint it.
	*/
	const CURSOR_GLOW_FILTER = `drop-shadow(0 0 6px color-mix(in srgb, var(--aeven-browser-overlay-glow, ${CURSOR_GLOW}) 90%, transparent)) drop-shadow(0 0 15px color-mix(in srgb, var(--aeven-browser-overlay-glow, ${CURSOR_GLOW}) 48%, transparent))`;
	/**
	* Namespacing hook: every generated class carries this prefix so the overlay
	* cannot collide with page styles and can be removed by prefix if a page's own
	* teardown fails.
	*/
	const CLASS_PREFIX = "aeven-browser-overlay";
	/**
	* Deterministic class name for a suffix.
	* @param suffix - the element's role, such as `cursor` or `ripple`.
	* @returns the prefixed class name.
	*/
	function cls(suffix) {
		return `${CLASS_PREFIX}-${suffix}`;
	}
	/**
	* The injected stylesheet.
	*
	* Every rule is scoped under the overlay root so a page can never be affected by
	* the overlay's presence, and every animated element is a child of that root.
	* Selection boxes use the same blue family as the cursor's glow so a hover, a
	* click, and the pointer read as one system rather than three unrelated
	* highlights.
	* @returns the stylesheet text, ready for a `<style>` element's `textContent`.
	*/
	function overlayStyles() {
		const root = `.${CLASS_PREFIX}`;
		return `
${root} {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  pointer-events: none;
  /* NOT contain: strict — paint containment would anchor fixed descendants here. */
  contain: layout style;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
  line-height: 1.25;
  color: rgb(15, 23, 42);
}

/*
 * Attached inside a caller's layer, the overlay fills that layer rather than the
 * window, and its own overflow is what keeps the pointer inside the panel. The
 * layer is the drawing region, so nothing has to clip it from outside.
 */
${root}[data-mount="container"] {
  position: absolute;
  overflow: hidden;
}

/* The cursor layer is the only element that ever animates position. */
${root} .${cls("cursor-layer")} {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

/*
 * The cursor box. Transform origin is the box centre, which is what the 44deg
 * sprite rotation is calibrated against — moving it would swing the arrow's tip
 * away from the point it is supposed to be pointing at.
 */
${root} .${cls("cursor")} {
  position: absolute;
  top: 0;
  left: 0;
  width: 24px;
  height: 24px;
  /* Motion is applied by the wrapper inside, so this box only positions. */
  will-change: transform;
  pointer-events: none;
}

${root} .${cls("cursor")}[data-visible="false"] {
  opacity: 0;
}

/*
 * The nudge lives on an inner wrapper, and the sprite inside it carries the
 * sprite's own base rotation. The wrapper's transform is owned entirely by the
 * motion model, so nothing here competes with it.
 */
${root} .${cls("cursor-sprite")} {
  display: block;
  position: absolute;
  left: 0;
  top: 0;
  transform: translate3d(${CURSOR_NUDGE.x}px, ${CURSOR_NUDGE.y}px, 0);
}

${root} .${cls("cursor-sprite")} img,
${root} .${cls("cursor-sprite")} canvas {
  display: block;
  /* Pin against a page's global img (max-width/box-sizing) rules. */
  box-sizing: content-box;
  max-width: none;
  max-height: none;
  width: ${CURSOR_SPRITE.width}px !important;
  height: ${CURSOR_SPRITE.height}px !important;
  transform: rotate(44deg) scale(1);
  transform-origin: 0 0;
  filter: ${CURSOR_GLOW_FILTER};
  -webkit-user-drag: none;
  user-select: none;
}

/* Target highlight: a 2px accent ring with a barely-there wash of accent. */
${root} .${cls("box")} {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid ${ACCENT};
  border-radius: 0;
  background: color-mix(in srgb, ${ACCENT} 3%, transparent);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28);
  pointer-events: none;
  transform-origin: center;
}

${root} .${cls("box")}[data-kind="hover"] {
  border-style: solid;
}

/* A region drag reads as provisional, so it stays dashed. */
${root} .${cls("box")}[data-kind="region"] {
  border-style: dashed;
}

/* Text selections keep a flat wash; a ring around each line would be noise. */
${root} .${cls("box")}[data-kind="text"] {
  border-color: transparent;
  background: #128dff66;
  box-shadow: none;
}

/* The label chip names the action in flight, e.g. "click". */
${root} .${cls("label")} {
  position: absolute;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.92);
  color: rgb(248, 250, 252);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.01em;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms ease-out;
}

${root} .${cls("label")}[data-visible="true"] {
  opacity: 1;
}

/* A click lands as an expanding ring plus a core flash. */
${root} .${cls("ripple")} {
  position: absolute;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;
  border-radius: 50%;
  border: 2px solid ${ACCENT};
  pointer-events: none;
  animation: ${cls("ripple")} 620ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
}

@keyframes ${cls("ripple")} {
  0% { opacity: 0.85; transform: scale(0.35); }
  100% { opacity: 0; transform: scale(2.6); }
}

${root} .${cls("flash")} {
  position: absolute;
  width: 22px;
  height: 22px;
  margin: -11px 0 0 -11px;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, ${ACCENT} 55%, transparent) 0%, transparent 70%);
  pointer-events: none;
  animation: ${cls("flash")} 380ms ease-out forwards;
}

@keyframes ${cls("flash")} {
  0% { opacity: 0.95; transform: scale(0.4); }
  100% { opacity: 0; transform: scale(1.5); }
}

/*
 * Typing shows a caret pulse at the caret's point rather than a ring, so a click
 * and a keystroke never look alike.
 */
${root} .${cls("caret")} {
  position: absolute;
  width: 2px;
  height: 16px;
  margin: -8px 0 0 -1px;
  background: ${ACCENT};
  pointer-events: none;
  animation: ${cls("caret")} 900ms steps(2, end) infinite;
}

@keyframes ${cls("caret")} {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0.15; }
}

/* Respect a page or OS that asks for less motion: state stays visible, motion stops. */
@media (prefers-reduced-motion: reduce) {
${root} .${cls("ripple")}, ${root} .${cls("flash")}, ${root} .${cls("caret")} {
  animation: none;
}
${root} .${cls("ripple")} { opacity: 0.5; transform: scale(1.6); }
${root} .${cls("flash")} { opacity: 0.35; }
${root} .${cls("caret")} { opacity: 0.9; }
}
`;
	}
	//#endregion
	//#region ../../packages/experimental/browser-overlay/src/cursor-asset.ts
	/**
	* The agent cursor sprite, embedded as a data URI.
	*
	* This is the exact asset the Codex desktop app's browser overlay draws: a
	* rounded black arrow with a white outline, 46x48 pixels, shown at
	* 23x24 CSS pixels. It is embedded rather than shipped as a file because the
	* overlay is injected into a page it does not own — a relative asset URL would
	* resolve against the target page's origin, and a separate file would need a
	* fetch that a strict page's CSP can block. A data URI cannot be blocked and
	* cannot 404.
	*
	* Extracted from the extracted Codex app bundle as the design reference; the
	* bytes are reproduced verbatim.
	* @module
	*/
	/** The sprite as a `data:` URI, safe to assign to `img.src` in any page. */
	const CURSOR_ASSET_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC4AAAAwCAYAAABuZUjcAAAG+klEQVR4Ae1ZW2xUVRS982qnj+lzSh9UrLWosVFq+TAkRmpi0URJSBogqRggavyF1Cj6Q0P94A+iURJDQrH6Q2OxIF/EEE0a0hqBEBKRQihSIYHQxwzTTtuZua51e/Z4GeZxh85MP2AnJ/d1HuvsvfY++5yraU/kiTzeYtN1PVq6u7vtvPK9fNOWSZzxXhIQhFfjecuWLfa7d+/a+vr6GvB+bPPmzXpzc7O+WHWxLu+15RTRLG7tbW1tzps3b64OhUKDeD+pK8Hzb4FA4MNr166tZh2pLxaRCedaqD4Ccfl8vo/MgOOJTOLcuXNVaCOTiFIpJ3RSgxigL168+EIq0DEyOT8///29e/fa165d6wKdHCwm8FKyAtpG0zc0NLjn5uZ+EETXr1/X8d7gNL7pu3btMt4lkkgkMsZJTE1NvclJoJ2DljA5d2aBs2M4XZ7X6/Vg8CkBsmnTJgN0bGlpadF7e3tTTgJK6IE/PIc2hiW0RatmzAI21an75MmTa8yDxwMdW2gRTmJyMjG7Yp1aJhFDpfQmw8bsDLdFe/bsaTIPSHpYAS9lx44d+vHjx/VkIpMYGhpagTbGJOJQKfUkVANXdXV1Ea7V6PSsDIIO0wIuhRPmJM6cOZNsDpOgUp84tab8wWQFTU/mF6JxAi8uLl5x9erVfdIzB34U4LGTSNepJSppyTSvKjjq6+sLcPVu27btAZ5LVMlEserUpJKyQuJoxA+cYVNTUz4eywsKCp7CAjS8VLqkKqmcemZm5hNGOpP2HwIe5XlFRUVJYWFh3YULFz6LEhEdZwO4ZsGpYZlXCV5bDKPxtU6e19XVFYLnVZ2dnS3hcHg6G3TRUviDmUagzLeKwk7ReuwMCC4CbYedTucCZj8Bb/9VPmIh0nIhY2Nj2s6dO6PPbrf7nWAw6ATfJRONKzblEJ6ioqIaLEbvmelSVlaWM62LIOb/g3flTEVUEvcwZ8j1xsbGCG7DmF0YTnEWHu7jN4DWEBG0XAgsH70HXX0ej8cBSyQPixJdALSM0eXWrVu9MvtMxPRUhb5k5jjo2g/gXvoevjsSAtcWA76zqqqqGNfqU6dOdWaTLuyPYA8cOPBQbGdw2L9//2uoV4niVsATat7QOj25pKSkAs7xDJblcemMK+BSwcpKSgsmS8xGRkY+p9VpfXI8ocZFlBPkl5eXl6JhPfj11VLpkkir8QTL/h+HDh3qyM/Pf5ZWR/GooGFLCVxli8XMXXp6etrMHadLlyNHjiQFisjhu3Hjxi9QSveGDRteR5tmgobSVoq2VRqcHLiunJQNFF0apqenR2SgdFIAajqeTExM/Hnp0qXvjh49+rHL5WpF3ZdRXkRpwnhP41pD0HRKpcQoaHsi4Az0PIKorKwMOxwOhsYFRJfT8n39+vWaVdm+fXv03u/3j0Kr+9rb299AavFBa2vr1/j+u91u9wGsH1WmsX748/Ly/NiJBUCZYG1t7QIXRkuD6WqTK5sL0oUpgFljVlMAM6cHBwe7AOol0OB5xd9VzIvYP0JeJX2K0YyBQVJbLU52mEzjHJQLQQR0odYXBgYGJqGxEaljXiQSCdoaReTw4cND0G4A5T4ila+0tNQPTd+HlgOwbgARJghLB9etWze/cePG8LFjx6jpiOCxJPr/xxXGBhrXuvPnz38q2rOSMTLjE6GPKC3XULPctHCho2Zj96D6Uk8DVAekSyFXr46OjlfSyRjN27bLly9/iXcroWUj7xCw+oNnL5kR0ToH4oAIT6vu3LkzIGAOHjyYFLhZED3eZbqs9rVGTNazeVzHmE5zki5wpFqrGaM5DHLlZUgVbVuKyRmQ6AaDng8AjVboYl50YKWfuJjgfQmKsZtZCo/tFuvpCFE6NxiIKiEk9Qu3b9/+WT7u3bs3biNz1Lly5crp2dnZEG7DmqJQWpHiUUTx0NA6Yyw3GOaMkRJ7aMSdvFm2bt26Bu+9sgXTckATAW84qRqYdGnADvwvAcZFhmeMcghkXnR4WiAZnjpFsGrpjADnxa5228wYV544ceJ93YLAudtgpWpay1KGlwXw0RQApYpOOjo6+k0iwMz4hoeHv2DCxEQNbWitnESTWDFOu6h1mh33dVgJV+/evfttOOsgHPdvgoXz/guq/NjV1fUW6jSh1KB4SBPZ7GYCSNptoHUHokQessV8RJoChMZCKDgP535OpKc2FS1CeJ7DdRZznEEJgv8hrKThTEQTp5a+GGcv0O4CH+Cg3K2EwXkXKMH+qFEdWmfomwPgeayWc9hBhWCFcNZDYAqxmXZIbjodkybFYy+vkp5qixtcmVDGuP3IHcmqBw0avwrBXzv4bWMZHx+XJT/Mhau/v5/P1jYCuRLd9NcZjw7572n657lsf5/TlZyA/Q9N3TljZhaAsAAAAABJRU5ErkJggg==";
	//#endregion
	//#region ../../packages/experimental/browser-overlay/src/sprite-canvas.ts
	/**
	* The cursor sprite painted on a canvas, for a page whose Content-Security-Policy
	* refuses `data:` images: the PNG is decoded here and its pixels written with
	* `putImageData`, which no page policy governs.
	* @module
	*/
	/** Bytes per RGBA pixel. */
	const PIXEL_BYTES = 4;
	/**
	* Decode an 8-bit, non-interlaced RGBA PNG.
	* @param bytes - the PNG file.
	* @returns its width, height, and pixels.
	* @throws {Error} when the PNG uses another format.
	*/
	async function decode(bytes) {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const width = view.getUint32(16);
		const height = view.getUint32(20);
		if (bytes[24] !== 8 || bytes[25] !== 6 || bytes[28] !== 0) throw new Error("the sprite is not an 8-bit RGBA PNG");
		const parts = [];
		for (let offset = 8; offset < bytes.length;) {
			const length = view.getUint32(offset);
			if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === "IDAT") parts.push(bytes.subarray(offset + 8, offset + 8 + length));
			offset += 12 + length;
		}
		const stream = new Blob(parts).stream().pipeThrough(new DecompressionStream("deflate"));
		const raw = new Uint8Array(await new Response(stream).arrayBuffer());
		const stride = width * PIXEL_BYTES;
		const pixels = new Uint8ClampedArray(new ArrayBuffer(stride * height));
		for (let row = 0; row < height; row++) {
			const filter = raw[row * (stride + 1)] ?? 0;
			const source = row * (stride + 1) + 1;
			const target = row * stride;
			for (let index = 0; index < stride; index++) {
				const value = raw[source + index] ?? 0;
				const left = index >= PIXEL_BYTES ? pixels[target + index - PIXEL_BYTES] ?? 0 : 0;
				const up = row > 0 ? pixels[target + index - stride] ?? 0 : 0;
				const upLeft = row > 0 && index >= PIXEL_BYTES ? pixels[target + index - stride - PIXEL_BYTES] ?? 0 : 0;
				let predicted = 0;
				switch (filter) {
					case 1:
						predicted = left;
						break;
					case 2:
						predicted = up;
						break;
					case 3:
						predicted = left + up >> 1;
						break;
					case 4: {
						const estimate = left + up - upLeft;
						const toLeft = Math.abs(estimate - left);
						const toUp = Math.abs(estimate - up);
						const toUpLeft = Math.abs(estimate - upLeft);
						predicted = toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft;
						break;
					}
				}
				pixels[target + index] = value + predicted & 255;
			}
		}
		return {
			width,
			height,
			pixels
		};
	}
	/**
	* Paint a PNG data URI onto a canvas the same size it is drawn at.
	* @param dataUrl - `data:image/png;base64,...`.
	* @returns the canvas, its backing store at the PNG's own resolution.
	*/
	async function spriteCanvas(dataUrl) {
		const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
		const { width, height, pixels } = await decode(Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)));
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		canvas.getContext("2d")?.putImageData(new ImageData(pixels, width, height), 0, 0);
		return canvas;
	}
	//#endregion
	//#region ../../packages/experimental/browser-overlay/src/springs.ts
	/**
	* The fixed integration step, in seconds.
	*
	* Fixed rather than per-frame on purpose: the same motion has to come out of a
	* 60Hz and a 120Hz display, and an input-driven step would not do that.
	*/
	const STEP_SECONDS = 1 / 240;
	/**
	* The stiffness ceiling, in 1/s^2.
	*
	* Present in React Spring to stop a very small `response` from producing a spring
	* stiff enough to go unstable at the fixed step.
	*/
	const MAX_STIFFNESS = 1 / (2 * STEP_SECONDS ** 2);
	/** Velocity and force below this count as stopped, in 1/60 s-scaled units. */
	const REST_VELOCITY = .06;
	/**
	* One display frame at 60Hz, in seconds: the simulation clock restarts this far
	* behind the script clock after a stall, and the frame loop never advances by less.
	*/
	const FRAME_SECONDS = 1 / 60;
	/**
	* Create a spring already at `value`, so nothing animates on first paint.
	* @param value - the starting value, which is also the spring's first target.
	* @param config - the spring's feel.
	* @returns a spring at rest on `value`.
	*/
	function createSpring(value, config) {
		return {
			value,
			target: value,
			velocity: 0,
			force: 0,
			simulationTime: 0,
			scriptTime: 0,
			config
		};
	}
	/**
	* Advance one spring by `seconds`.
	*
	* The strategy is React Spring's: track time on a `scriptTime` clock, and run the
	* simulation in fixed `STEP_SECONDS` steps until it catches up. When the two
	* clocks drift by more than a second, the simulation clock restarts one
	* {@link FRAME_SECONDS} behind instead of catching up, so a stall cannot produce
	* a visible jump. A settled spring snaps its value to the target and keeps its
	* residual velocity and force, as the reference's solver does.
	* @param spring - mutated in place.
	* @param seconds - elapsed wall time; negative values count as 0.
	*/
	function stepSpring(spring, seconds) {
		const response = Math.max(.001, spring.config.response);
		const stiffness = Math.min((Math.PI * 2) ** 2 / response ** 2, MAX_STIFFNESS);
		const damping = Math.sqrt(stiffness) * 2 * spring.config.dampingFraction;
		spring.scriptTime += Math.max(0, seconds);
		if (spring.scriptTime - spring.simulationTime > 1) spring.simulationTime = spring.scriptTime - FRAME_SECONDS;
		while (spring.simulationTime < spring.scriptTime) {
			integrate(spring, stiffness, damping);
			spring.simulationTime += STEP_SECONDS;
		}
		if (hasSettled(spring)) spring.value = spring.target;
	}
	/**
	* One fixed step: half-step velocity from the current force, advance position,
	* then rebuild the force. This is the semi-implicit ordering React Spring uses,
	* and it is why a spring here settles the way it does rather than ringing.
	*/
	function integrate(spring, stiffness, damping) {
		const half = STEP_SECONDS / 2;
		const velocity = spring.velocity + spring.force * half;
		spring.value += velocity * STEP_SECONDS;
		spring.force = velocity * -damping + (spring.target - spring.value) * stiffness;
		spring.velocity = velocity + spring.force * half;
	}
	/**
	* React Spring's rest test.
	*
	* Both the velocity and the force must be small, and the remaining distance must
	* be inside a tolerance proportional to the target. A spring passing through its
	* target at speed is therefore not at rest even though its offset is briefly zero.
	*/
	function hasSettled(spring) {
		if (Math.max(spring.velocity ** 2, spring.force ** 2) > REST_VELOCITY ** 2) return false;
		const tolerance = spring.target * .01;
		const remaining = spring.target - spring.value;
		return tolerance === 0 || remaining ** 2 <= tolerance ** 2;
	}
	/**
	* Whether a spring has arrived and stopped.
	* @param spring - the spring to test.
	* @returns true when it sits exactly on its target with velocity and force near zero.
	*/
	function isAtRest(spring) {
		return spring.value === spring.target && hasSettled(spring);
	}
	/**
	* Aim an angle spring at `degrees` the short way around, keeping its velocity.
	* @param spring - the angle spring, in degrees.
	* @param degrees - the angle to reach; any equivalent angle is accepted.
	*/
	function retargetAngle(spring, degrees) {
		let delta = degrees - spring.value;
		while (delta > 180) delta -= 360;
		while (delta < -180) delta += 360;
		spring.target = spring.value + delta;
	}
	/**
	* Move a spring without animating, as the reference does when it teleports.
	* @param spring - the spring to move.
	* @param value - the value it takes immediately; velocity, force, and both clocks reset with it.
	*/
	function jumpSpring(spring, value) {
		spring.force = 0;
		spring.simulationTime = 0;
		spring.scriptTime = 0;
		spring.target = value;
		spring.value = value;
		spring.velocity = 0;
	}
	/**
	* The cursor's spring tuning, copied from the reference implementation.
	*
	* Each is a separate spring there, with its own feel; together they are what make
	* a long glide settle differently from a short scoot. `response` is the arrival
	* time constant and `dampingFraction` the overshoot, both in React Spring's terms.
	*/
	const CURSOR_SPRINGS = {
		/** Travel springs: identical on both axes so a diagonal move stays straight. */
		position: {
			dampingFraction: .9,
			response: .19
		},
		/** Rotation tracks a curve's tangent, so it is the snappiest spring present. */
		rotation: {
			dampingFraction: .9,
			response: .12
		},
		/** The idle fade is the slowest, so the cursor appears rather than pops. */
		visibility: {
			dampingFraction: .86,
			response: .42
		},
		/** A short hop splits into an axis-aligned scoot plus a small overshoot. */
		scootAxis: {
			dampingFraction: .9,
			response: .12
		},
		scootRotation: {
			dampingFraction: .82,
			response: .055
		},
		scootStretch: {
			dampingFraction: .86,
			response: .12
		},
		/** Speed-driven lengthwise stretch during a glide. */
		stretch: {
			dampingFraction: .85,
			response: .2
		}
	};
	/** Speed in px/s at which the cursor stops stretching along its travel. */
	const STRETCH_SPEED_PX_PER_SECOND = 5500;
	/** Minimum lengthwise stretch, applied at top speed. */
	const MIN_STRETCH = .65;
	/** How long the idle wobble lasts, in seconds, after which it stops re-arming. */
	const THINK_DURATION_SECONDS = 1.41;
	/** Frequency of the idle wobble, in cycles per second. */
	const THINK_FREQUENCY = .66;
	/** Amplitude of the idle wobble, in degrees. */
	const THINK_AMPLITUDE_DEG = 12.5;
	/**
	* Scale the pointer starts from as it appears, 1 being full size. The pointer
	* grows into place as activity resumes and shrinks back as it fades, which is
	* what the reference's `lerp(0.4, 1, visibility)` does.
	*/
	const APPEAR_SCALE = .4;
	/** Snap a value into [min, max]. */
	function clamp(value, min, max) {
		return Math.min(max, Math.max(min, value));
	}
	/**
	* Wrap an angle difference into (-180, 180].
	*
	* Needed because a rotation spring must take the short way around: asking it to
	* go from 170deg to -170deg should move 20deg, not 340deg.
	* @param from - the starting angle in degrees.
	* @param to - the target angle in degrees.
	* @returns the wrapped difference from `from` to `to`, in degrees.
	*/
	function shortestAngleDelta(from, to) {
		let delta = to - from;
		while (delta > 180) delta -= 360;
		while (delta < -180) delta += 360;
		return delta;
	}
	/**
	* Normalize a rotation for display into [0, 360).
	*
	* The composition carries a negative base rotation, so this is what keeps the
	* emitted `rotate()` values comparable with the reference's.
	* @param degrees - the angle to normalize, in degrees.
	* @returns the equivalent angle in [0, 360).
	*/
	function normalizeDegrees(degrees) {
		const wrapped = degrees % 360;
		return (wrapped < 0 ? wrapped + 360 : wrapped) + 0;
	}
	function distance(a, b) {
		return Math.hypot(b.x - a.x, b.y - a.y);
	}
	function point(x, y) {
		return {
			x,
			y,
			tangent: 0
		};
	}
	function unit(x, y) {
		const length = Math.hypot(x, y);
		return length < .001 ? point(1, 0) : point(x / length, y / length);
	}
	function handle(bounds, origin, direction, length) {
		let span = length;
		if (direction.x < 0) span = Math.min(span, origin.x / -direction.x);
		if (direction.x > 0) span = Math.min(span, (bounds.width - origin.x) / direction.x);
		if (direction.y < 0) span = Math.min(span, origin.y / -direction.y);
		if (direction.y > 0) span = Math.min(span, (bounds.height - origin.y) / direction.y);
		return point(origin.x + direction.x * Math.max(0, span), origin.y + direction.y * Math.max(0, span));
	}
	function cubic(start, segment, t) {
		const u = 1 - t;
		return point(start.x * u ** 3 + 3 * segment.control1.x * u ** 2 * t + 3 * segment.control2.x * u * t ** 2 + segment.end.x * t ** 3, start.y * u ** 3 + 3 * segment.control1.y * u ** 2 * t + 3 * segment.control2.y * u * t ** 2 + segment.end.y * t ** 3);
	}
	function metrics(path, bounds) {
		let length = 0, energy = 0, maxTurn = 0, totalTurn = 0;
		let angle;
		let previous = path.start;
		const inside = (p) => bounds === void 0 || p.x >= 20 && p.x <= bounds.width - 20 && p.y >= 20 && p.y <= bounds.height - 20;
		let staysInBounds = inside(previous);
		let start = path.start;
		for (const segment of path.segments) {
			for (let sample = 1; sample <= 24; sample++) {
				const at = cubic(start, segment, sample / 24);
				length += distance(previous, at);
				staysInBounds &&= inside(at);
				if (distance(previous, at) > .01) {
					const next = Math.atan2(at.y - previous.y, at.x - previous.x);
					if (angle !== void 0) {
						const turn = shortestAngleDelta(angle * 180 / Math.PI, next * 180 / Math.PI) * Math.PI / 180;
						energy += turn * turn;
						maxTurn = Math.max(maxTurn, Math.abs(turn));
						totalTurn += Math.abs(turn);
					}
					angle = next;
				}
				previous = at;
			}
			start = segment.end;
		}
		return {
			length,
			energy,
			maxTurn,
			totalTurn,
			staysInBounds
		};
	}
	function reversePenalty(path) {
		const direction = unit(path.end.x - path.start.x, path.end.y - path.start.y);
		const angle = -44 * Math.PI / 180;
		return clamp((-(direction.x * Math.sin(angle) - direction.y * Math.cos(angle)) - .08) / .92, 0, 1);
	}
	/**
	* Select the reference's smoothest bounded cubic or two-segment arc.
	* @param start - initial cursor position.
	* @param end - destination.
	* @param bounds - drawing region; omitted for standalone callers with no measured viewport.
	* @returns the lowest-scoring in-bounds path, or the lowest-scoring candidate if none fits.
	*/
	function createArcPath(start, end, bounds = {
		width: Infinity,
		height: Infinity
	}) {
		const span = distance(start, end);
		const angle = -44 * Math.PI / 180;
		const click = point(Math.sin(angle), -Math.cos(angle));
		const reverse = point(-click.x, -click.y);
		const direction = unit(end.x - start.x, end.y - start.y);
		const startLength = Math.max(48, Math.min(640, span * .41960295031576633, span * .9));
		const endLength = Math.max(48, Math.min(640, span * .15, span * .9));
		const first = handle(bounds, start, click, startLength);
		const last = handle(bounds, end, reverse, endLength);
		const shortFirst = handle(bounds, start, click, startLength * .65);
		const shortLast = handle(bounds, end, reverse, endLength * .65);
		const candidates = [{
			start,
			end,
			arc: false,
			segments: [{
				control1: first,
				control2: last,
				end
			}]
		}, {
			start,
			end,
			arc: false,
			segments: [{
				control1: shortFirst,
				control2: shortLast,
				end
			}]
		}];
		const normal = point(-direction.y, direction.x);
		const sign = normal.x * click.x + normal.y * click.y >= 0 ? 1 : -1;
		for (const arcScale of [
			.55,
			.8,
			1.05
		]) for (const handleScale of [
			.65,
			1,
			1.35
		]) for (const side of [sign, -sign]) {
			const offset = Math.max(50, Math.min(520, span * .2765523188064277)) * arcScale;
			const flow = Math.max(38, Math.min(440, span * .5783555327868779)) * handleScale;
			const arc = point((start.x + end.x) / 2 + normal.x * side * offset + click.x * startLength * .16, (start.y + end.y) / 2 + normal.y * side * offset + click.y * startLength * .16);
			candidates.push({
				start,
				end,
				arc: true,
				segments: [{
					control1: first,
					control2: point(arc.x - direction.x * flow, arc.y - direction.y * flow),
					end: arc
				}, {
					control1: point(arc.x + direction.x * flow, arc.y + direction.y * flow),
					control2: last,
					end
				}]
			});
		}
		const scored = candidates.slice(0, 20).map((candidate) => {
			const m = metrics(candidate, bounds);
			const detour = Math.max(0, m.length / Math.max(1, span) - 1);
			const value = m.length + detour * 320 + m.energy * 140 + m.maxTurn * 180 + m.totalTurn * 18 + reversePenalty(candidate) * 90 + (candidate.arc ? 45 : 0);
			return {
				candidate,
				staysInBounds: m.staysInBounds,
				value
			};
		});
		const lowest = (entries) => entries.reduce((best, entry) => entry.value < best.value ? entry : best).candidate;
		const inside = scored.filter((entry) => entry.staysInBounds);
		return inside.length === 0 ? lowest(scored) : lowest(inside);
	}
	/** The segment at one index of a travel path, which always holds at least one segment. */
	function segmentAt(path, index) {
		const segment = path.segments[index];
		if (segment === void 0) throw new Error("a travel path always holds at least one segment");
		return segment;
	}
	/**
	* Sample a cubic journey and its tangent as a screen rotation.
	* @param path - selected journey.
	* @param t - progress in [0, 1].
	* @returns sampled position and rotation in degrees, where zero points upwards.
	*/
	function samplePath(path, t) {
		const progress = clamp(t, 0, 1);
		const index = progress === 1 ? path.segments.length - 1 : Math.floor(progress * path.segments.length);
		const segment = segmentAt(path, index);
		const start = index === 0 ? path.start : segmentAt(path, index - 1).end;
		const local = progress === 1 ? 1 : progress * path.segments.length - index;
		const u = 1 - local;
		const at = cubic(start, segment, local);
		const dx = 3 * u * u * (segment.control1.x - start.x) + 6 * u * local * (segment.control2.x - segment.control1.x) + 3 * local * local * (segment.end.x - segment.control2.x);
		const dy = 3 * u * u * (segment.control1.y - start.y) + 6 * u * local * (segment.control2.y - segment.control1.y) + 3 * local * local * (segment.end.y - segment.control2.y);
		return {
			...at,
			tangent: Math.hypot(dx, dy) < .001 ? -44 : Math.atan2(dy, dx) * 180 / Math.PI + 90
		};
	}
	function pathResponse(path) {
		const m = metrics(path);
		const complexity = clamp(clamp(Math.max(0, m.length / Math.max(1, distance(path.start, path.end)) - 1) / .55, 0, 1) * .42 + clamp(m.totalTurn / (Math.PI * 1.4), 0, 1) * .38 + clamp(m.energy / 1.25, 0, 1) * .2, 0, 1);
		return clamp((.42 + clamp((m.length - 180) / 760, 0, 1) * .22 + complexity * .12 + reversePenalty(path) * .28 + (path.arc ? .04 : 0)) * .7 * (path.arc ? .9 : 1), .12, 2.2);
	}
	/**
	* One cursor spring set: where it is, how it is turned, and how it is moving.
	*
	* All of it is state rather than a timeline, so an interruption is just a new
	* target for the springs that are already running.
	*/
	var CursorMotion = class {
		/** X position in viewport coordinates, in CSS pixels. */
		positionX = createSpring(0, CURSOR_SPRINGS.position);
		/** Y position in viewport coordinates, in CSS pixels. */
		positionY = createSpring(0, CURSOR_SPRINGS.position);
		/** Sprite rotation in degrees; it rests at {@link BASE_ROTATION_DEG} and banks toward a curve's tangent on a long move. */
		rotation = createSpring(-44, CURSOR_SPRINGS.rotation);
		/** Scale a glide applies: 1 when the cursor is stopped, down to {@link MIN_STRETCH} at top speed. */
		stretch = createSpring(1, CURSOR_SPRINGS.stretch);
		/** Drives opacity and blur: 0 hidden, 1 fully shown. */
		visibility = createSpring(0, CURSOR_SPRINGS.visibility);
		/** Angle of the axis a short move travels along, in degrees. */
		scootAxis = createSpring(0, CURSOR_SPRINGS.scootAxis);
		/** Overshoot rotation a short move adds to {@link rotation}, in degrees. */
		scootRotation = createSpring(0, CURSOR_SPRINGS.scootRotation);
		/** Scale a short move applies perpendicular to its axis, dipping below 1 at mid-move. */
		scootStretch = createSpring(1, CURSOR_SPRINGS.scootStretch);
		/** Position along the current arc, spring-driven from 0 at its start to 1 at its end. */
		progress = createSpring(0, CURSOR_SPRINGS.rotation);
		#path;
		#scootFrom;
		#scootTo;
		#scootAxisTarget = 0;
		#scootRotationTarget = 0;
		#thinkStartedAt;
		#thinkEnabled = true;
		#journeyStarted = false;
		/**
		* Whether a long move started since the last call. The reference advances the
		* first frame of a long move by exactly one 60Hz frame, whatever time passed.
		* @returns true once per started long move.
		*/
		takeJourneyStart() {
			const started = this.#journeyStarted;
			this.#journeyStarted = false;
			return started;
		}
		/** Current position, in viewport coordinates. */
		get point() {
			return {
				x: this.positionX.value,
				y: this.positionY.value
			};
		}
		/** Whether the cursor is still on its way to the last target it was sent to. */
		get isTravelling() {
			return this.#path !== void 0 || this.#scootFrom !== void 0 || !isAtRest(this.positionX) || !isAtRest(this.positionY);
		}
		/** Whether the idle wobble is running now. */
		get isThinking() {
			return this.#thinkEnabled && this.#thinkStartedAt !== void 0;
		}
		/**
		* Start the idle wobble again, for a pointer its host wants visibly alive.
		*
		* The wobble is otherwise a fixed moment of life after arriving; a host that
		* holds the pointer while the agent works can keep it breathing, so a long
		* action shows a pointer that is present rather than one that froze.
		*/
		keepThinking() {
			if (this.#thinkEnabled && this.#thinkStartedAt === void 0) this.#thinkStartedAt = performance.now();
		}
		/** Whether anything is still moving; used to stop the animation frame loop. */
		get isResting() {
			if (this.#path !== void 0) return false;
			if (this.#thinkEnabled && this.#thinkStartedAt !== void 0) return false;
			return isAtRest(this.positionX) && isAtRest(this.positionY) && isAtRest(this.rotation) && isAtRest(this.scootAxis) && isAtRest(this.scootRotation) && isAtRest(this.scootStretch) && isAtRest(this.stretch) && isAtRest(this.visibility);
		}
		/**
		* Place the cursor without animating, as the reference does on a jump.
		*
		* Any move in flight is dropped.
		* @param x - target x coordinate in CSS pixels.
		* @param y - target y coordinate in CSS pixels.
		*/
		jumpTo(x, y) {
			jumpSpring(this.positionX, x);
			jumpSpring(this.positionY, y);
			this.#path = void 0;
			this.#scootFrom = void 0;
			this.#scootTo = void 0;
			jumpSpring(this.rotation, -44);
			jumpSpring(this.scootAxis, 0);
			jumpSpring(this.scootRotation, 0);
			jumpSpring(this.scootStretch, 1);
			jumpSpring(this.stretch, 1);
		}
		/**
		* Set the visibility target; the caller hides the cursor by animating to 0.
		* The idle wobble is armed by arrival, not by showing.
		* @param visible - whether the cursor should end up shown.
		*/
		setVisible(visible) {
			this.visibility.target = visible ? 1 : 0;
		}
		/**
		* Enable or disable the idle wobble, stopping any wobble in progress.
		*
		* The wobble moves the arrow's tip by up to {@link THINK_AMPLITUDE_DEG} degrees,
		* so anything that needs to measure where the cursor points has to turn it off
		* first: measuring mid-wobble reports a tip position that changes frame to frame,
		* which is a limit cycle rather than a calibration error.
		* @param enabled - whether the wobble runs; disabling also discards a wobble in progress.
		*/
		setThinkEnabled(enabled) {
			this.#thinkEnabled = enabled;
			if (!enabled) this.#thinkStartedAt = void 0;
		}
		/**
		* Aim the cursor at a point, choosing an arc or a scoot by distance.
		*
		* The move itself is driven by {@link step}.
		* @param x - target x coordinate in CSS pixels.
		* @param y - target y coordinate in CSS pixels.
		* @param bounds - measured drawing region for path selection.
		* @returns the move's expected duration in milliseconds, so a caller can decide whether to wait; 0 when already there.
		*/
		travelTo(x, y, bounds) {
			this.#thinkStartedAt = void 0;
			const destination = this.#path?.end ?? this.#scootTo;
			if (destination?.x === x && destination.y === y) return this.#path === void 0 ? 420 : 700;
			const from = {
				x: this.positionX.value,
				y: this.positionY.value,
				tangent: 0
			};
			const distance = Math.hypot(x - from.x, y - from.y);
			if (distance < .5) {
				this.jumpTo(x, y);
				return 0;
			}
			if (distance > 196) {
				this.#scootFrom = void 0;
				this.#scootTo = void 0;
				this.#path = createArcPath(from, {
					x,
					y,
					tangent: 0
				}, bounds);
				const response = pathResponse(this.#path);
				this.progress.config = {
					response,
					dampingFraction: .9
				};
				jumpSpring(this.progress, 0);
				this.progress.target = 1;
				this.positionX.config = this.positionY.config = {
					response: clamp(response * .18, .035, .12),
					dampingFraction: .9
				};
				this.#journeyStarted = true;
			} else {
				this.#path = void 0;
				this.positionX.config = this.positionY.config = CURSOR_SPRINGS.position;
				this.progress.config = {
					response: .19,
					dampingFraction: .94
				};
				jumpSpring(this.progress, 0);
				this.progress.target = 1;
				this.#scootFrom = from;
				this.#scootTo = {
					x,
					y,
					tangent: 0
				};
				/* v8 ignore next -- unreachable: the ARRIVAL_EPSILON_PX early return above already holds distance >= 0.5. */
				const axis = distance < .001 ? 0 : Math.atan2(y - from.y, x - from.x) * 180 / Math.PI;
				this.#scootAxisTarget = axis;
				this.#scootRotationTarget = clamp(((x - from.x) * .75 - (y - from.y) * .62) / Math.hypot(x - from.x, y - from.y), -1, 1) * 70;
				retargetAngle(this.rotation, -44);
				retargetAngle(this.scootAxis, this.#scootAxisTarget);
				this.positionX.target = x;
				this.positionY.target = y;
			}
			return distance > 196 ? 700 : 420;
		}
		/**
		* Advance every spring by `seconds`.
		* @param seconds - elapsed time since the previous step, in seconds.
		* @returns true while the cursor still needs another frame.
		*/
		step(seconds) {
			stepSpring(this.visibility, seconds);
			if (this.#path !== void 0) this.#stepArc(seconds);
			else if (this.#scootFrom !== void 0) this.#stepScoot(seconds);
			else {
				this.stretch.target = 1;
				this.scootStretch.target = 1;
				this.scootRotation.target = 0;
			}
			stepSpring(this.stretch, seconds);
			stepSpring(this.scootStretch, seconds);
			stepSpring(this.scootRotation, seconds);
			return !this.isResting;
		}
		#stepArc(seconds) {
			const path = this.#path;
			/* v8 ignore next -- narrows for the compiler only: the sole call site tests #path !== undefined, and nothing writes it in between. */
			if (path === void 0) return;
			this.scootStretch.target = 1;
			this.scootRotation.target = 0;
			stepSpring(this.progress, seconds);
			const t = clamp(this.progress.value, 0, 1);
			const at = samplePath(path, t);
			this.positionX.target = at.x;
			this.positionY.target = at.y;
			retargetAngle(this.rotation, at.tangent);
			retargetAngle(this.scootAxis, 0);
			const previous = this.point;
			stepSpring(this.positionX, seconds);
			stepSpring(this.positionY, seconds);
			stepSpring(this.rotation, seconds);
			stepSpring(this.scootAxis, seconds);
			const speed = Math.hypot(this.positionX.value - previous.x, this.positionY.value - previous.y) / Math.max(seconds, 1 / 240);
			this.stretch.target = clamp(1 - speed / STRETCH_SPEED_PX_PER_SECOND, MIN_STRETCH, 1);
			if (t >= .999 && Math.abs(this.progress.velocity) < .01 && this.#near(at)) {
				const end = samplePath(path, 1);
				jumpSpring(this.positionX, end.x);
				jumpSpring(this.positionY, end.y);
				jumpSpring(this.rotation, normalizeDegrees(end.tangent));
				jumpSpring(this.scootAxis, 0);
				jumpSpring(this.stretch, 1);
				this.#path = void 0;
				this.#thinkStartedAt = performance.now();
			}
		}
		#stepScoot(seconds) {
			const from = this.#scootFrom;
			const to = this.#scootTo;
			/* v8 ignore next -- narrowing only: the sole call site tests #scootFrom, and the pair is written and cleared together. */
			if (from === void 0 || to === void 0) return;
			stepSpring(this.progress, seconds);
			this.positionX.target = to.x;
			this.positionY.target = to.y;
			retargetAngle(this.scootAxis, this.#scootAxisTarget);
			retargetAngle(this.rotation, -44);
			stepSpring(this.positionX, seconds);
			stepSpring(this.positionY, seconds);
			stepSpring(this.rotation, seconds);
			stepSpring(this.scootAxis, seconds);
			const at = {
				x: this.positionX.value,
				y: this.positionY.value
			};
			const spanX = to.x - from.x;
			const spanY = to.y - from.y;
			const lengthSquared = spanX * spanX + spanY * spanY;
			/* v8 ignore next 3 -- unreachable: lengthSquared is the square of a move distance the epsilon early return holds to >= 0.5. */
			const travelled = lengthSquared < .001 ? 1 : clamp(((at.x - from.x) * spanX + (at.y - from.y) * spanY) / lengthSquared, 0, 1);
			const bell = Math.sin(Math.min(1, travelled) * Math.PI);
			this.stretch.target = 1;
			this.scootRotation.target = this.#scootRotationTarget * bell;
			this.scootStretch.target = 1 - .15 * bell;
			if (travelled >= .999 && Math.abs(this.progress.velocity) < .01 && this.#near(to)) {
				this.jumpTo(to.x, to.y);
				this.rotation.target = -44;
				this.rotation.value = -44;
				this.scootAxis.target = 0;
				this.scootRotation.target = 0;
				this.scootStretch.target = 1;
				this.#scootFrom = void 0;
				this.#scootTo = void 0;
				this.#thinkStartedAt = performance.now();
			}
		}
		#near(target) {
			return Math.hypot(this.positionX.value - target.x, this.positionY.value - target.y) <= .85 && Math.abs(this.positionX.velocity) <= 12 && Math.abs(this.positionY.velocity) <= 12;
		}
		/**
		* The rotation to draw, including the idle wobble.
		*
		* The wobble is a decaying oscillation added on top of the settled rotation, so
		* it never changes where the cursor points for more than a moment.
		* @param now - current time in milliseconds.
		* @returns the rotation to draw in degrees, with the wobble folded in.
		*/
		displayRotation(now) {
			if (!this.#thinkEnabled || this.#thinkStartedAt === void 0) return this.rotation.value;
			const elapsed = (now - this.#thinkStartedAt) / 1e3 - 0;
			if (elapsed < 0) return this.rotation.value;
			const progress = Math.min(1, elapsed / THINK_DURATION_SECONDS);
			if (progress >= 1) {
				this.#thinkStartedAt = void 0;
				return this.rotation.value;
			}
			return this.rotation.value + thinkWobble(elapsed, progress);
		}
	};
	/**
	* The idle wobble's angular offset at a point inside its window.
	*
	* A sine at {@link THINK_FREQUENCY} under a half-sine envelope, so it starts and
	* ends at zero and never leaves a residue in the settled rotation.
	* @param elapsedSeconds - time since the wobble began.
	* @param progress - fraction of the window already elapsed, in [0, 1].
	* @returns the offset in degrees, to be added to the settled rotation.
	*/
	function thinkWobble(elapsedSeconds, progress) {
		const envelope = Math.sin(progress * Math.PI);
		return Math.sin(elapsedSeconds / THINK_FREQUENCY * Math.PI * 2) * envelope * THINK_AMPLITUDE_DEG;
	}
	/**
	* Build the cursor's CSS transform string.
	*
	* The order is the reference's: the box is translated so its own origin lands on
	* the point, then the axis-aligned scoot is applied as rotate/scale/unrotate, and
	* last the sprite's own rotation and lengthwise stretch. The nested rotate pair
	* is what keeps a stretched cursor pointing along its axis rather than shearing.
	* @param input - the point to place, the rotations to compose, and the
	*   appearance scale the visibility spring drives.
	* @returns the transform value, with every angle and offset rounded to three decimals.
	*/
	function cursorTransform(input) {
		const half = input.boxSize / 2;
		const parts = [`translate3d(${round(input.point.x - half)}px, ${round(input.point.y - half)}px, 0)`];
		const total = normalizeDegrees(input.rotation + input.scootRotation);
		const scoot = clamp(input.scootStretch, 0, 1);
		if (Math.abs(shortestAngleDelta(0, input.scootAxisRotation)) > .001 || Math.abs(scoot - 1) > .001) parts.push(`rotate(${round(input.scootAxisRotation)}deg)`, `scale(1, ${round(scoot)})`, `rotate(${round(-input.scootAxisRotation)}deg)`);
		parts.push(`rotate(${round(total)}deg)`, `scale(${round(input.stretch * input.appearance)}, ${round(input.appearance)})`);
		return parts.join(" ");
	}
	/** Round to three decimals, matching the reference's emitted precision. */
	function round(value) {
		return Math.round(value * 1e3) / 1e3;
	}
	/**
	* Blur, opacity, and scale driven by the visibility spring: the pointer zooms
	* in as it appears and shrinks as it fades, so resuming activity reads as the
	* pointer growing back into place instead of a sprite blinking on.
	* @param visibility - the spring's value, from 0 hidden to 1 shown.
	* @returns the opacity, the blur radius in CSS pixels, and the scale to apply;
	*   all three settle at full size and zero blur once the pointer is shown.
	*/
	function visibilityStyles(visibility) {
		const clamped = clamp(visibility, 0, 1);
		return {
			opacity: clamped,
			blurPx: (1 - clamped) * 5,
			scale: APPEAR_SCALE + .6 * clamped
		};
	}
	/** How long one click's ripple stays on screen, in milliseconds. */
	const RIPPLE_MS = 620;
	/**
	* Offset of a first appearance from its target, in CSS pixels: 120px, short of
	* the motion model's long-move threshold, so the entry is a quick straight
	* glide that lands before the host's action does.
	*/
	/** How long a typing caret stays visible at a point, in milliseconds. */
	const CARET_MS = 900;
	/**
	* The injected overlay.
	*
	* One instance owns one document. Constructing it has no side effects; call
	* {@link attach} to put it on screen and {@link destroy} to take it off and
	* release every listener it registered.
	*/
	var BrowserOverlay = class {
		#options;
		#root;
		/** Element the overlay was attached into, absent when it spans the window. */
		#container;
		#cursor;
		#label;
		#box;
		#hoverTarget;
		#sounds;
		#point;
		/** Region nothing is drawn outside; also the bound a target point is clamped into. */
		#clip;
		/** Whether the host is holding the pointer, which suspends the idle fade. */
		#hold = false;
		#idleTimer;
		#caretTimer;
		#listeners;
		#motion;
		#frame;
		#lastFrameAt = 0;
		#arrivals = [];
		constructor(options = {}) {
			this.#options = {
				sound: options.sound ?? false,
				idleHideMs: options.idleHideMs ?? 2e4,
				decorations: options.decorations ?? true
			};
		}
		/** Whether the overlay is currently on screen. */
		get attached() {
			return this.#root !== void 0;
		}
		/** Where the pointer currently sits, in viewport coordinates. */
		get point() {
			return this.#point === void 0 ? void 0 : { ...this.#point };
		}
		/** Which moment of an action the pointer is currently expressing. */
		get mode() {
			return this.#cursor?.dataset.mode === "add" ? "add" : "comment";
		}
		/**
		* Put the overlay on screen, idempotently.
		*
		* The stylesheet and every element are created once and reused, so a repeated
		* call is a no-op rather than a second layer. It appends to the caller's
		* `container` when one is named, and otherwise to `documentElement`, not
		* `body`, so a page that replaces its body mid-session does not orphan it.
		* @param options - per-attach overrides; identical to the constructor's.
		* @returns this instance, for chaining.
		*/
		attach(options = {}) {
			const { container, ...rest } = options;
			Object.assign(this.#options, rest);
			if (this.#root !== void 0) return this;
			this.#container = container;
			const doc = document;
			const root = doc.createElement("div");
			root.className = CLASS_PREFIX;
			root.setAttribute("aria-hidden", "true");
			root.dataset.visible = "false";
			if (container !== void 0) root.dataset.mount = "container";
			const style = doc.createElement("style");
			style.textContent = overlayStyles();
			root.append(style);
			const box = doc.createElement("div");
			box.className = cls("box");
			box.dataset.kind = "hover";
			box.style.display = "none";
			const label = doc.createElement("div");
			label.className = cls("label");
			const layer = doc.createElement("div");
			layer.className = cls("cursor-layer");
			const cursor = doc.createElement("div");
			cursor.className = cls("cursor");
			cursor.dataset.mode = "comment";
			cursor.dataset.visible = "false";
			const wrapper = doc.createElement("div");
			wrapper.className = cls("cursor-sprite");
			const sprite = doc.createElement("img");
			sprite.alt = "";
			sprite.draggable = false;
			sprite.decoding = "sync";
			sprite.dataset.aevenBrowserOverlaySprite = "";
			sprite.addEventListener("error", () => {
				spriteCanvas(CURSOR_ASSET_URL).then((canvas) => {
					sprite.replaceWith(canvas);
				}, () => void 0);
			}, { once: true });
			sprite.src = CURSOR_ASSET_URL;
			wrapper.append(sprite);
			cursor.append(wrapper);
			layer.append(cursor);
			if (this.#options.decorations) root.append(box, label);
			root.append(layer);
			this.#root = root;
			this.#cursor = cursor;
			this.#label = this.#options.decorations ? label : void 0;
			this.#box = this.#options.decorations ? box : void 0;
			this.#motion = new CursorMotion();
			const parent = this.#container ?? doc.documentElement;
			if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", () => {
				if (this.#root !== void 0) parent.append(this.#root);
			}, { once: true });
			else parent.append(root);
			const listeners = new AbortController();
			const reposition = () => {
				this.#redrawBox();
			};
			addEventListener("scroll", reposition, {
				capture: true,
				passive: true,
				signal: listeners.signal
			});
			addEventListener("resize", reposition, {
				passive: true,
				signal: listeners.signal
			});
			this.#listeners = listeners;
			return this;
		}
		/**
		* Remove the overlay and release every listener, timer, and audio resource.
		*
		* Safe to call when already detached. The DOM subtree is removed outright
		* rather than hidden, so a page's own selector queries cannot observe it.
		*/
		destroy() {
			this.#settleArrivals();
			if (this.#frame !== void 0) cancelAnimationFrame(this.#frame);
			this.#frame = void 0;
			this.#motion = void 0;
			if (this.#idleTimer !== void 0) clearTimeout(this.#idleTimer);
			if (this.#caretTimer !== void 0) clearTimeout(this.#caretTimer);
			this.#idleTimer = void 0;
			this.#caretTimer = void 0;
			this.#listeners?.abort();
			this.#listeners = void 0;
			this.#root?.remove();
			this.#sounds?.close().catch(() => {});
			this.#sounds = void 0;
			this.#root = void 0;
			this.#cursor = void 0;
			this.#label = void 0;
			this.#box = void 0;
			this.#hoverTarget = void 0;
			this.#point = void 0;
		}
		/**
		* Show the pointer at a point, gliding from wherever it last was.
		* @param point - target in viewport coordinates.
		* @param options - `mode` switches the pointer shape; `label` names the action.
		*/
		moveTo(point, options = {}) {
			if (this.#root === void 0) return;
			if (options.mode !== void 0) this.#setMode(options.mode);
			this.#glideTo(point);
			this.#setLabel(options.label);
			this.#armIdleTimer();
		}
		/**
		* Whether the pointer is drawn now, as opposed to faded out. A host reads
		* this to decide whether a layout change has something to re-place.
		* @returns true while the cursor element is shown.
		*/
		get showing() {
			return this.#cursor?.dataset.visible === "true";
		}
		/**
		* Move the pointer to a point a layout change put its target at.
		*
		* Layout corrections preserve visibility and replace position without starting a journey.
		* @param point - the new point, in the same coordinates {@link moveTo} takes.
		*/
		reposition(point) {
			const target = this.#clampPoint(point);
			this.#point = target;
			this.#motion?.jumpTo(target.x, target.y);
			this.#settleArrivals();
			this.#startFrameLoop();
		}
		/**
		* Hold the pointer on screen, or release it to the idle fade.
		*
		* A host holds the pointer while the agent is working: the gaps between an
		* agent's actions are not the reader's cue that it has finished. Releasing the
		* hold restarts the idle countdown, so a pointer that is no longer held still
		* fades on its own rather than staying on a page forever.
		* @param hold - whether the pointer is held.
		*/
		setHold(hold) {
			if (this.#hold === hold) return;
			this.#hold = hold;
			if (hold && (this.#motion?.visibility.value ?? 0) <= .001) this.#point = void 0;
			if (hold) {
				if (this.#idleTimer !== void 0) clearTimeout(this.#idleTimer);
				this.#idleTimer = void 0;
				if (this.#motion?.visibility.target === 1) this.#startFrameLoop();
				return;
			}
			this.#armIdleTimer();
		}
		/**
		* Wait for the pointer to finish its current glide, so a host can let the
		* action it announced land where the pointer visibly is.
		* @param signal - cancels an owned action waiting for arrival.
		* @returns a promise that resolves within 1500ms, once the pointer rests on its target, at
		* once when it is not travelling, and when the overlay is hidden or destroyed; cancellation rejects.
		*/
		arrived(signal) {
			signal?.throwIfAborted();
			if (this.#motion === void 0 || this.#frame === void 0 || !this.#motion.isTravelling) return Promise.resolve();
			return new Promise((resolve, reject) => {
				const finish = () => {
					clearTimeout(timer);
					signal?.removeEventListener("abort", abort);
					const index = this.#arrivals.indexOf(finish);
					if (index >= 0) this.#arrivals.splice(index, 1);
					resolve();
				};
				const abort = () => {
					const reason = signal?.reason;
					reject(reason instanceof Error ? reason : /* @__PURE__ */ new Error("The pointer wait was cancelled."));
					finish();
				};
				const timer = setTimeout(finish, 1500);
				this.#arrivals.push(finish);
				signal?.addEventListener("abort", abort, { once: true });
			});
		}
		/**
		* Highlight a page element without moving the pointer onto it.
		*
		* Accepts either the element itself or a plain rectangle. Prefer the element:
		* a rectangle is a snapshot of where the element was, so a scroll or reflow
		* leaves the box behind, floating over whatever moved into those coordinates.
		* An element reference lets the box re-measure on scroll and resize.
		*
		* Passing `undefined` clears the highlight.
		* @param target - the element to track, or its current viewport rectangle.
		* @param options - `kind` picks the box treatment for the action in flight.
		*/
		hover(target, options = {}) {
			if (this.#box === void 0 || !this.#options.decorations) return;
			if (target === void 0) {
				this.#hoverTarget = void 0;
				this.#box.style.display = "none";
				delete this.#box.dataset.rect;
				return;
			}
			this.#box.dataset.kind = options.kind ?? "hover";
			if (target instanceof Element) {
				this.#hoverTarget = target;
				delete this.#box.dataset.rect;
			} else {
				this.#hoverTarget = void 0;
				this.#box.dataset.rect = JSON.stringify(target);
			}
			this.#redrawBox();
		}
		/**
		* Draw one click at a point: the pointer arrives, a ring expands, and the
		* pointer dwells briefly so the action is readable rather than instantaneous.
		* @param point - where the click landed, in viewport coordinates.
		* @param options - `mode` and `label` as in {@link moveTo}.
		*/
		click(point, options = {}) {
			if (this.#root === void 0) return;
			this.moveTo(point, {
				mode: options.mode ?? "comment",
				...options.label === void 0 ? {} : { label: options.label }
			});
			if (!this.#options.decorations) {
				this.#playClick();
				return;
			}
			this.#spawnAt(point, cls("ripple"), RIPPLE_MS);
			this.#spawnAt(point, cls("flash"), 380);
			this.#playClick();
		}
		/**
		* Show a blinking caret at a point, for a typing action.
		* @param point - the caret's position in viewport coordinates.
		* @param options - `label` names the action.
		*/
		type(point, options = {}) {
			if (this.#root === void 0) return;
			this.moveTo(point, {
				mode: "comment",
				...options.label === void 0 ? {} : { label: options.label }
			});
			if (!this.#options.decorations) return;
			const caret = this.#spawnAt(point, cls("caret"), CARET_MS);
			if (this.#caretTimer !== void 0) clearTimeout(this.#caretTimer);
			this.#caretTimer = setTimeout(() => {
				caret.remove();
			}, CARET_MS);
		}
		/**
		* Show a scroll at a point: the pointer travels with the gesture.
		*
		* The travel is the whole affordance. A chevron drawn alongside it said the
		* same thing twice, in a hue the page around it need not share, and read as
		* an artifact on a page that had not asked for it.
		* @param point - the point the wheel event targeted, in viewport coordinates.
		* @param options - optional label carried with the pointer travel.
		*/
		scroll(point, options = {}) {
			if (this.#root === void 0) return;
			this.moveTo(point, {
				mode: "comment",
				...options.label === void 0 ? {} : { label: options.label }
			});
		}
		/**
		* Enable or disable the idle wobble.
		*
		* Off is the state a screenshot or a coordinate measurement needs, because the
		* wobble moves the tip by a few degrees and would otherwise make the same
		* question return different answers on consecutive frames.
		* @param enabled - whether the wobble runs; disabling also discards a wobble in progress.
		*/
		setThinkEnabled(enabled) {
			this.#motion?.setThinkEnabled(enabled);
		}
		/**
		* Fade the pointer out without detaching the overlay.
		*
		* The fade runs on the visibility spring, whose opacity the frame loop writes
		* inline. The last point survives the fade, so the next action travels from
		* where the pointer faded instead of re-entering near its new target.
		* @param options - `immediate` removes the pointer in this frame instead of
		* fading it, for when what it points at has itself left the screen.
		*/
		hide(options = {}) {
			this.#settleArrivals();
			if (this.#idleTimer !== void 0) clearTimeout(this.#idleTimer);
			this.#idleTimer = void 0;
			this.#setLabel(void 0);
			this.hover(void 0);
			if (this.#cursor !== void 0) this.#cursor.dataset.visible = "false";
			if (this.#root !== void 0) this.#root.dataset.visible = "false";
			const motion = this.#motion;
			if (motion === void 0) return;
			if (options.immediate === true) {
				motion.setVisible(false);
				motion.visibility.value = 0;
				motion.visibility.velocity = 0;
				if (this.#cursor !== void 0) this.#cursor.style.opacity = "0";
				return;
			}
			if (motion.visibility.target === 0) return;
			motion.setVisible(false);
			this.#startFrameLoop();
		}
		/**
		* Confine everything the overlay draws to one viewport rectangle, such as the
		* frame of the page the pointer acts on, so a pointer mid-flight never paints
		* over the host's own surfaces.
		* @param rect - the region to draw in, or `undefined` to draw anywhere.
		*/
		clipTo(rect) {
			this.#clip = rect;
			if (this.#root === void 0) return;
			this.#root.style.clipPath = rect === void 0 ? "" : `inset(${rect.y}px ${innerWidth - rect.x - rect.width}px ${innerHeight - rect.y - rect.height}px ${rect.x}px)`;
		}
		/**
		* Record which moment of an action the pointer is showing.
		*
		* One sprite serves every mode, so there is no glyph to swap; the mode only
		* drives the label's wording. It is still stored so a host can read it back.
		*/
		#setMode(mode) {
			if (this.#cursor === void 0 || this.#cursor.dataset.mode === mode) return;
			this.#cursor.dataset.mode = mode;
		}
		/**
		* Travel to a point under spring motion, arcing when the move is long.
		*
		* The move is not a tween, so a second call mid-flight redirects the springs
		* that are already running rather than restarting from rest. That is what makes
		* a rapid sequence of actions read as one continuous pointer instead of a
		* series of jumps.
		*/
		/**
		* Bring a point inside the region the overlay draws in.
		*
		* A point outside that region would put the pointer over content it does not
		* name, so a target off the region is brought to its edge instead. The region
		* is the caller's clip, or the layer the overlay fills once that layer has a
		* box: a layer still unlaid-out has no edge to clamp against.
		*/
		#clampPoint(point) {
			const container = this.#container;
			const region = this.#clip ?? (container === void 0 || container.clientWidth === 0 || container.clientHeight === 0 ? void 0 : {
				x: 0,
				y: 0,
				width: container.clientWidth,
				height: container.clientHeight
			});
			if (region === void 0) return point;
			return {
				x: Math.min(Math.max(point.x, region.x), region.x + region.width),
				y: Math.min(Math.max(point.y, region.y), region.y + region.height)
			};
		}
		#glideTo(point) {
			const cursor = this.#cursor;
			const root = this.#root;
			const motion = this.#motion;
			if (cursor === void 0 || root === void 0 || motion === void 0) return;
			const target = this.#clampPoint(point);
			const first = this.#point === void 0 || motion.visibility.value <= .001;
			this.#point = { ...target };
			cursor.dataset.visible = "true";
			root.dataset.visible = "true";
			motion.setVisible(true);
			if (first) {
				motion.jumpTo(target.x, target.y);
				jumpSpring(motion.visibility, 1);
				this.#settleArrivals();
			} else motion.travelTo(target.x, target.y, {
				width: this.#container?.clientWidth ?? innerWidth,
				height: this.#container?.clientHeight ?? innerHeight
			});
			this.#startFrameLoop();
		}
		/**
		* Drive the motion model and write its result to the DOM.
		*
		* One frame loop for position, rotation, and every secondary spring, rather
		* than one animation per property: the springs share a clock, so the composed
		* transform is always internally consistent.
		*/
		#startFrameLoop() {
			if (this.#frame !== void 0) return;
			this.#lastFrameAt = performance.now();
			const tick = (now) => {
				const motion = this.#motion;
				const cursor = this.#cursor;
				if (motion === void 0 || cursor === void 0) {
					this.#frame = void 0;
					return;
				}
				const seconds = motion.takeJourneyStart() ? FRAME_SECONDS : Math.max(FRAME_SECONDS, (now - this.#lastFrameAt) / 1e3);
				this.#lastFrameAt = now;
				const moving = motion.step(seconds);
				const visibility = visibilityStyles(motion.visibility.value);
				cursor.style.transform = cursorTransform({
					point: motion.point,
					rotation: motion.displayRotation(now),
					scootAxisRotation: motion.scootAxis.value,
					scootRotation: motion.scootRotation.value,
					scootStretch: motion.scootStretch.value,
					stretch: motion.stretch.value,
					appearance: visibility.scale,
					boxSize: 24
				});
				cursor.style.opacity = `${visibility.opacity}`;
				cursor.style.filter = `blur(${visibility.blurPx}px)`;
				if (!motion.isTravelling) this.#settleArrivals();
				if (moving || motion.isThinking || motion.visibility.value !== motion.visibility.target) this.#frame = requestAnimationFrame(tick);
				else this.#frame = void 0;
			};
			this.#frame = requestAnimationFrame(tick);
		}
		/** Resolve everything waiting on {@link arrived}. */
		#settleArrivals() {
			const arrivals = this.#arrivals;
			this.#arrivals = [];
			for (const resolve of arrivals) resolve();
		}
		#setLabel(text) {
			const label = this.#label;
			const point = this.#point;
			if (label === void 0 || point === void 0) return;
			if (text === void 0 || text === "") {
				label.dataset.visible = "false";
				return;
			}
			label.textContent = text;
			label.dataset.visible = "true";
			const width = label.offsetWidth || 0;
			const height = label.offsetHeight || 0;
			const x = point.x + 18 + width > innerWidth ? Math.max(4, point.x - 18 - width) : point.x + 18;
			const y = point.y + 14 + height > innerHeight ? Math.max(4, point.y - 14 - height) : point.y + 14;
			label.style.transform = `translate(${x}px, ${y}px)`;
		}
		#redrawBox() {
			const box = this.#box;
			if (box === void 0) return;
			let rect;
			if (this.#hoverTarget !== void 0) {
				if (!this.#hoverTarget.isConnected) {
					this.#hoverTarget = void 0;
					box.style.display = "none";
					delete box.dataset.rect;
					return;
				}
				const measured = this.#hoverTarget.getBoundingClientRect();
				rect = {
					x: measured.x,
					y: measured.y,
					width: measured.width,
					height: measured.height
				};
			} else {
				const raw = box.dataset.rect;
				if (raw === void 0) return;
				rect = JSON.parse(raw);
			}
			box.style.display = "block";
			box.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
			box.style.width = `${rect.width}px`;
			box.style.height = `${rect.height}px`;
		}
		/** Create one transient visual element at a point; removes itself on animation end. */
		#spawnAt(point, className, ttlMs) {
			const node = document.createElement("div");
			node.className = className;
			node.style.left = `${point.x}px`;
			node.style.top = `${point.y}px`;
			this.#root?.append(node);
			setTimeout(() => {
				node.remove();
			}, ttlMs);
			return node;
		}
		#armIdleTimer() {
			if (this.#idleTimer !== void 0) clearTimeout(this.#idleTimer);
			if (this.#hold || this.#options.idleHideMs <= 0) return;
			this.#idleTimer = setTimeout(() => {
				this.hide();
			}, this.#options.idleHideMs);
		}
		/**
		* A click sound synthesized in-process.
		*
		* Synthesized rather than shipped as an asset: a few hundred bytes of code beat
		* a binary in the bundle, and the timbre is not the point — a short, quiet tick
		* is enough to signal that an action landed.
		*/
		#playClick() {
			if (!this.#options.sound) return;
			try {
				this.#sounds ??= new AudioContext();
				const ctx = this.#sounds;
				const at = ctx.currentTime;
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.type = "triangle";
				osc.frequency.setValueAtTime(1180, at);
				osc.frequency.exponentialRampToValueAtTime(560, at + .045);
				gain.gain.setValueAtTime(1e-4, at);
				gain.gain.exponentialRampToValueAtTime(.06, at + .006);
				gain.gain.exponentialRampToValueAtTime(1e-4, at + .07);
				osc.connect(gain).connect(ctx.destination);
				osc.start(at);
				osc.stop(at + .08);
			} catch {}
		}
	};
	//#endregion
	//#region ../../packages/experimental/browser-overlay/src/index.ts
	/**
	* Auto-installing entry point for the overlay bundle.
	*
	* A host injects this bundle into a page it is operating; the page never imports
	* it. Installation is therefore a side effect of loading, and it is idempotent
	* through the `window` global so a re-injection after a soft navigation reuses the
	* live overlay instead of stacking a second one.
	*
	* A document-start injection runs before the parser has created `documentElement`,
	* which is the normal way a CDP host installs this — `Page.addScriptToEvaluateOnNewDocument`
	* fires first. {@link installOverlay} therefore defers the actual attach to
	* `DOMContentLoaded` when the document is still loading, so the call is safe at any
	* point in the document lifecycle.
	*
	* ```js
	* await session.send('Page.addScriptToEvaluateOnNewDocument', { source: bundle })
	* await session.send('Runtime.evaluate', { expression: 'window.__aevenOverlay.click({ x: 120, y: 340 })' })
	* ```
	* @module
	*/
	/**
	* Attach the overlay, waiting for a document that can hold it.
	*
	* Returns the instance immediately so a caller can queue actions against it; those
	* actions are no-ops until the root exists, which is the correct behavior for a
	* document that has not been parsed yet.
	*/
	function attachWhenReady(overlay) {
		if (document.readyState !== "loading") {
			overlay.attach();
			return overlay;
		}
		document.addEventListener("DOMContentLoaded", () => {
			overlay.attach();
		}, { once: true });
		return overlay;
	}
	/**
	* The installed overlay, attaching it if this is the first evaluation.
	* @returns the page's overlay instance; every later call returns that same one.
	*/
	function installOverlay() {
		window.__aevenOverlay ??= attachWhenReady(new BrowserOverlay());
		return window.__aevenOverlay;
	}
	window.__aevenOverlayModule = { installOverlay };
	installOverlay();
	//#endregion
	exports.BrowserOverlay = BrowserOverlay;
	exports.installOverlay = installOverlay;
	return exports;
})({});
