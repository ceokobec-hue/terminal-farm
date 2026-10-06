# Rendering traps

Each of these looks like a small detail and is not. They are ordered roughly by when you will
hit them while building.

These are engine-agnostic problems. The examples name three.js because a concrete API is more
use than a vague principle, but every one of them is a property of real-time rendering rather than
of a library — the equivalent trap exists in Godot, Unity, Unreal and bare WebGPU, usually under a
different name. Where a specific call is mentioned, the sentence before it says what the call is
*for*, so the advice survives the translation.

## Contents

- [Ground and plots](#ground-and-plots)
- [Which side gets drawn](#which-side-gets-drawn)
- [Instanced skinned characters](#instanced-skinned-characters)
- [Making motion match the body](#making-motion-match-the-body)
- [Resolution and quality](#resolution-and-quality)
- [Post-processing](#post-processing)
- [Transforms and timing](#transforms-and-timing)
- [Things that hold their size on screen](#things-that-hold-their-size-on-screen)

## Ground and plots

**A raised deck has to clear the worst terrain it could sit on.** Terrain is generated, so a
plot can be dealt any height in the range. Size the slab against the roughest case, not the
average, or the ground comes through it: the slab reads as sunken, props stand buried to the
waist, and every surface where the two meet tears. Then measure everything on a plot from that
one number rather than giving each prop a height of its own.

**Scatter must be rebuilt when plot footprints change.** The order is the whole problem: the
world is built before the first roster arrives, so at that moment there are no plots to avoid.
Boulders and trees end up under decks laid on top of them afterwards, poking through in
fragments. Rebuild scatter whenever a zone's footprint changes — cheap, if scatter does not
drag the terrain mesh along with it.

**Generated primitives have the wrong UVs for anything you draw on them.**

- A hex tile is a six-sided cylinder, and a cylinder's cap UVs are a *disc* — which turns a
  tiling plate pattern into a medallion, one per tile. Reproject the top from world XZ so seams
  run straight across a whole zone.
- Keep the cylinder's own *side* unwrap for the rim. A fixed horizontal axis like `x + z` is
  constant along two of every six faces, leaving them with no UV gradient, a degenerate tangent,
  and — since the normal-mapped shading frame is built from it — solid black. Arc length from
  `atan2` fixes the gradient but adds a seam where the wrap crushes many repeats into one face.
  The generated unwrap has neither problem because it duplicates vertices at the seam.
- A box hands all six faces the same 0..1 square, so a strip pattern gets stretched down the
  sides and across the ends too. Point only the face you mean at the pattern and the rest at a
  patch of flat colour on the same texture.

**Derive normal maps from the height field you drew.** On a large flat surface under one
directional light, a flat albedo pattern reads as wallpaper. A seam that catches a shadow on
one edge and a highlight on the other reads as metal. Sobel over your own canvas is enough.

## Which side gets drawn

These two are opposites and both are correct:

**Open procedural shells** — bowls, engine bells, collars — need double-sided rendering, or you
look straight through them. They also cannot shadow-map single-sided: from the light, a concave
interior is a back face at exactly its own depth, so it self-shadows to solid black whichever
cull mode the depth pass uses. Draw them double-sided, and render their shadow pass from the
back faces — in three.js that is `shadowSide: BackSide`; elsewhere look for whichever setting
controls which faces the depth-only pass keeps.

**Closed kit models** must be single-sided, for the opposite reason. Modular kits are stacked
boxes, which leaves a floor and the ceiling beneath it sharing a plane all over the set. Drawn
double-sided, both halves of every pair rasterise at identical depth and the winner is settled
by floating-point noise — a whole scene of surfaces flickering as the camera moves. Back-face
culling throws the downward half away before it can fight.

The tell that culling is a complete fix rather than a partial one: *every* clash is an up/down
pair, never up/up.

## Instanced skinned characters

**Bake the animation into a bone-matrix texture.** Sample each clip at a fixed rate, write every
frame's skinning matrices into a float texture, and give each instance one float: the frame it
is on. Skin in the vertex shader *before* the per-instance transform is applied, so the skinned
vertex still gets placed by it — in three.js that means running ahead of `instanceMatrix`.

**Bake non-looping clips a millisecond short of their duration.** Sampled at exactly `duration`,
the mixer's default loop mode wraps to the start — so the frame a sit-down or a spawn is meant
to *hold* becomes the pose it began from, and the character snaps upright on the last frame of
sitting down.

**Write worn-item anchor transforms during the bake.** Storing head and chest world transforms
per frame makes placing a helmet one matrix read instead of a skeleton evaluation, and means a
helmet can never be a frame out of step with the head under it.

## Making motion match the body

**Choose the clip from the distance actually covered last frame, not from intended velocity.**
The two come apart the moment something is in the way: collision refuses the step while velocity
stays high, and a character driven off intent alone walks on the spot against a wall. Rise
instantly and fall over about a tenth of a second, so setting off is caught on the frame it
happens while a stride still gets to finish.

**Shape the movement to match the clips you have.** Walk a leg at a decisive pace and stop dead
on arrival rather than easing down through speeds no standing clip can carry. Abandon a leg that
runs into a wall at the first refused step.

**Routing and collision must be independent.** Routing finds a way *around* obstacles; collision
applies to every step whether or not a path is being followed. Routing can fail — a site walled
in between polls, a path budget that has not caught up — and walking through a wall must not be
what happens when it does. Blocked head-on, slide along the obstacle instead of stopping dead.

**Place standing spots clear of the obstacle's own blocked radius and validate them against the
navigation grid.** A spot inside a wall can never be reached, and whatever is sent there walks
at that wall forever. Give up after a few seconds of being blocked and adopt the ground you got
to.

**Separate characters by the widest thing they wear.** Holding a crowd tighter than its widest
part is a crowd standing inside itself. Derive arrival distance from the same number and make it
deliberately larger — something that had to get closer than its neighbours allow can never
finish arriving, and will shoulder at the crowd forever.

## Resolution and quality

**Render scale is a share of the display's own resolution, not of CSS pixels.** Size the drawing
buffer directly; `setPixelRatio` cannot usefully go below 1 on a retina panel. Reading the
setting as CSS pixels quietly renders every retina machine at half resolution, and the first
place it shows is small elements that hold a constant size on screen — exactly the things you
lean in to read.

**An adaptive quality governor should scale *under* the chosen setting, about one step per
second.** Reacting per frame makes the resolution visibly breathe. Make its floor relative too:
half of what the display can show, not half a CSS pixel. And when the user has just proved the
machine cannot hold a level, do not climb back to it ten seconds later — that is the
oscillation.

**Turning an effect off should dispose its render targets**, not merely skip the pass. On a weak
machine the point is to give the memory back.

## Post-processing

**Buffer parity will bite you.** Any ping-pong post chain that carries its read/write targets
across frames — three.js's `EffectComposer` is one, but the pattern is universal — will alternate
which target holds the scene if the number of swaps per frame is odd. Passes that do not request a
swap write into the *read* buffer, which is what makes the count odd without it being obvious. Any pass that
samples the depth texture must ask which buffer it is in *this* frame rather than binding one
target once at construction — otherwise every other frame samples last frame's depth, which
looks like the whole picture strobing rather than like a depth bug.

**Tilt-shift should be depth of field, not a screen-space band.** A band across the screen knows
nothing about the scene: zoom in until everything in frame is at one distance and the top and
bottom stay smeared anyway. Read the depth buffer, blur by distance from a plane of focus, and
put the plane on whatever the camera is orbiting so the subject is sharp at any zoom. Tilting
that plane is what a real tilt-shift lens does, and it is one dot product.

Attaching a depth texture to the target you already render into costs one attachment. Reach for
a built-in depth-of-field pass only after checking what it does to get depth — several, including
three.js's `BokehPass`, render the entire scene a second time with a depth material, which is a
steep price for something the main pass could have written for free.

**A separable gaussian's taps must be spaced as a fraction of the radius.** Kernels with fixed
offsets assume a roughly one-pixel step; scaled up to a twenty-pixel radius the taps drift apart
and you see discrete copies of the image rather than a blur. Sigma at a third of the radius puts
three standard deviations at the outermost tap, so what you ignore is negligible rather than
chopped off — a truncated gaussian is what gives a blur a hard edge.

**Blur in linear HDR, after bloom.** Blurring before bloom drops out-of-focus highlights below
the bloom threshold and switches the glow off exactly where the eye expects most of it.

**Keep the bloom threshold high.** It should be an accent — eyes, lamps, windows, sparks — not a
haze over everything lit. Author those specific things above 1.0 deliberately.

**The sky shader can be the environment map.** Render a second copy of the sky dome sharing the
same uniforms into a prefiltered radiance map and bind it as the scene environment. That is what
gives metal something to reflect, and it is why the scene changes *character* through the day
rather than just changing brightness. Regenerate only when the sky actually moved.

**Do not put the sun overhead at noon.** A sun at the zenith puts `N·L` at zero on every
vertical wall, and they go black with only ambient to catch. Tilt the solar arc. Curved
procedural shapes hide this; a kit of flat-walled modules does not.

## Transforms and timing

**World transforms are usually only recomputed as part of drawing.** Scene graphs propagate
parent transforms down to children lazily, at render time, because doing it eagerly on every
change would be wasteful. So anything that reads a world position after moving objects but before
drawing gets a stale matrix — often the identity, which quietly resolves local coordinates as
world ones and puts things at the origin.

If you reposition the world and immediately need a world-space point out of it, force the update
first. In three.js that is `scene.updateMatrixWorld(true)`; the general shape is "ask the scene
graph to flush before you query it".

This is especially easy to hit in offline/scripted rendering, where you may run many simulation
steps between draws.

**Screen-space UI anchored to world objects should be moved with a transform**, not with layout
properties, so following a moving target costs nothing.

**Hit-test billboarded labels in screen space.** If a quad is billboarded in the vertex shader, a
raycast tests where it was authored, not where it ended up.

## Things that hold their size on screen

Badges and labels that stay near-constant on screen invert the usual texture problem: they are
minified when you pull the camera out and *magnified* when you lean in, and the close end is the
one that hurts. Size them for the closest you can get — generously large atlas cells, labels
drawn at several times their display size — so at the tightest zoom there is still roughly one
texel per device pixel. Mipmaps and anisotropy carry the far end. If everything is drawn from
paths, more texels cost only memory.
