---
name: agent-session-world
description: >-
  Build someone a living 3D world out of their own coding-agent sessions, in whatever form they
  ask for — little robots on a moon, fish in a reef, animals in a forest, villagers, ants, boats
  in a harbour. Each thread becomes an inhabitant, each project becomes somewhere for them to
  live, and what a thread is really doing decides what its inhabitant does. This skill supplies
  the structure that makes any version of it work — the mapping from session state to world
  state, layouts that stay put, one draw call for a crowd, a Google-Earth camera, day and night,
  PBR and image-based lighting, depth of field, quality presets, and click-to-interact — while
  leaving the setting and the creatures entirely up to whoever is asking. Use it whenever someone
  wants a game, toy, ambient display, screensaver or spatial dashboard made from their Claude
  Code / Codex / OpenCode threads, wants their agents shown as characters or creatures instead of
  a list, or needs any single piece of that — instancing hundreds of animated characters, reading
  agent session state off disk, or making a real-time scene look good.
---

# Worlds built from coding sessions

Somebody arrives with an idea. *"I want my agents to be little fish."* *"Can it be a forest with
animals?"* *"Robots on a moon."* Your job is to build that — a small 3D world they leave open on a
second monitor, where every coding-agent thread on their machine is an inhabitant, every project
they work on is somewhere for those inhabitants to live, and what each thread is genuinely doing
decides what its inhabitant is doing.

**The metaphor is theirs. The structure is always the same.** A reef and a moon base differ in
models, palette and vocabulary, and in almost nothing else: both need a layout that does not
reshuffle, one draw call for the whole crowd, a single source of truth for state, and a camera
that feels like it has weight. This skill is that structure. Do not talk anyone out of their
metaphor — take it and fill in the frame.

Two principles hold across every version, and they are what separate this from a dashboard with a
3D skin:

**Everything visible means something.** An inhabitant rests because its thread has gone quiet, not
because resting looks nice. A structure is large because that thread has done a lot of work. The
moment decoration and data mix, none of it can be trusted and the whole thing becomes wallpaper.

**It has to be pleasant when nothing is happening.** Most threads are idle most of the time. A
world someone is happy to leave open while quiet is the entire point — so spend the effort on
ambient life and light, and save the loud signals for the one inhabitant that actually wants them.

## Start by capturing their concept

Before any code, get four things. One round of questions, with your own suggestions attached so
they can just say "yes" — this is meant to take a minute, not to be an interrogation.

1. **What lives here?** The inhabitant. One per thread.
2. **What is the setting?** Determines terrain, sky, palette, and what "night" means.
3. **What does a project's home look like?** The territory one project owns — an island, a
   clearing, a hex of ground, a reef shelf, a district.
4. **What does working look like here?** The single most important animation, and the one that has
   to read from across the map.

If they are vague, propose something concrete and start building; a running world is a far better
prompt for their opinions than a questionnaire. Expect the metaphor to shift once they see it
moving, and keep the art layer separable so that stays cheap.

Write their answers down somewhere in the project. Everything after refers back to it.

## The mapping is the actual design

Fill in this table for their world. It is the whole design document, and it is worth agreeing
before modelling anything.

| The world | Their sessions |
| --- | --- |
| One territory | One project or repo |
| One inhabitant | One thread |
| How developed its structure looks | How much work that thread has done |
| An inhabitant stopping and asking | The thread needs a reply |
| Arriving from somewhere | A thread just appeared |
| Leaving | It was archived |

## States: the same six, in any costume

This is the heart of it, and it is where the metaphor does its work. Decide state **once**, in one
ordered function — first match wins — and have the world and any UI both read it. If two places
can disagree about what a thread is doing, eventually they will, and an inhabitant happily working
next to a panel saying it crashed destroys trust in everything else on screen.

The order is worth reasoning about rather than copying. Errored outranks working because a thread
that fell over mid-run is stuck, not busy. Waiting sits below working because a thread that is
still running is not waiting on anyone yet.

| Thread state | What it must read as | Fish | Woodland animals | Robots |
| --- | --- | --- | --- | --- |
| Errored | Something is wrong, visible at distance | Lists sideways, colour drains | Sits, ears flat | Slumps, eyes red |
| Working now | Busy and purposeful | Darting, sediment kicked up | Carrying, digging | Hammering, sparks |
| Finished well | Good news, worth a glance | Loops, bright flash | Leaps, tail up | Jumps, confetti |
| **Waiting on you** | **Asking for you specifically** | Rises and faces the camera | Stands on hind legs | Waves |
| Untouched for days | Dormant, not dead | Drifts near the bottom | Curled asleep | Sits, `z` |
| Anything else | Present, unbothered | Mills about the reef | Forages | Potters |

Three rules travel with that table whatever the costume:

**Locomotion beats status.** Something crossing its territory moves — it does not slide along in a
working pose. Choose the animation from the distance actually covered last frame rather than the
velocity intended, because the two come apart the moment something is in the way: collision
refuses the step while velocity stays high, and anything driven off intent alone walks on the spot
against a wall.

**Give the working state a prop.** A tool in hand, a carried item, a mouthful of something. It is
what lets you read the temperature of the whole map without zooming in, and it is worth more than
a better model.

**Only signal what wants attention.** Badge the states that want something and nothing else. With
most of a real thread list quiet, a symbol over every head buries the one that matters.

## What every version needs

These are capabilities rather than designs — how they look is the metaphor's business, but a world
missing any of them will feel thin.

**Something visible from anywhere when a thread needs a reply.** A light column, a raised flag, a
plume. Distinct from all other colour, visible at any zoom and through geometry. Pair it with a
key that flies to the next one waiting. That pairing is what turns the thing from decoration into
something genuinely used, and it is the highest-value feature in the whole build.

**Territories that stay put.** The obvious approach — sort projects by size, hand out ground in
order — is wrong in a way that stays invisible until the thing is in use. One new thread changes
the sort, the sort changes the ground, and the map rearranges. A territory someone was watching
jumps across the screen because a *different* project gained a thread.

Make the previous arrangement an input to the next. A project needing the same room keeps exactly
the ground it had; one that grew keeps its ground and claims neighbours; one that shrank gives
back what it claimed most recently, so growing and shrinking returns it to the shape it started
in. Only a never-placed project gets placed. Persist it. A map you can learn is the whole reason
to do this spatially; one that reshuffles is worse than a list.

**Structures that grow with the work.** Whatever a "home" is in this metaphor, how developed it
looks should track how much that thread has done — transcript size on a log scale reads well.
Drive it with a shader offset rather than rebuilding geometry, and sink the structure while
discarding what falls below ground, so a half-grown one is a *whole* structure partly buried.
Slicing the top off instead guts closed shells and turns a half-finished dome into an empty ring.

**A camera with weight.** Model it on Google Earth, and specifically the two behaviours that make
Earth feel like Earth: dragging grabs the ground so the point under the cursor stays pinned there
for the whole drag, and scrolling zooms at the cursor rather than the screen centre. Approximate
versions feel wrong in a way people notice without being able to name. Add tilt and rotate on
right-drag, pinch on trackpads, keyboard movement, and a slow optional orbit that yields the
instant anyone touches the camera and eases back a couple of seconds after they stop.

**Day and night.** The cheapest way to make a static scene feel like a place. Make the sky itself
the environment map — render a second copy of the sky dome sharing the same uniforms into a
prefiltered radiance map and bind it as the scene environment. That is what gives materials
something to reflect, and why the world changes *character* through the day rather than just
dimming. Light it after dark rather than only darkening it: windows, lamps, glowing edges,
whatever the metaphor offers. Do not put the sun directly overhead at noon, or every vertical
surface goes black with only ambient to catch.

**Materials that behave.** PBR throughout, image-based lighting from that sky, bloom with a high
enough threshold that it picks out lights rather than hazing everything, shadows that track the
camera rather than covering the world, and depth of field with real bokeh — read the depth buffer
and blur by distance from a plane of focus, with the plane on whatever the camera is orbiting. A
screen-space band that blurs the top and bottom of the frame is the cheap fake and it shows the
moment you zoom in. Shallow focus is also what makes a large scene read as a small model, which is
usually exactly the feeling wanted.

**A settings panel with presets.** Five steps from lowest to highest, defaulting to a middle one
that looks good on an ordinary laptop without the fans coming on. Every individual knob adjustable
underneath, with some mark showing which have been moved away from their preset. Add a governor
that watches frame time and scales *under* whatever was chosen, about one step per second —
reacting per frame makes the resolution visibly breathe — and make turning an effect off actually
release its memory rather than just skipping the pass.

**Click an inhabitant to act on its thread.** Show what it is in a card parked next to it on
screen, following it as it moves, rather than in a fixed side panel — the answer to "what is this
one" belongs next to the thing that was clicked. Offer the two actions worth having: open the
thread in the agent it came from, and archive it. Make arrival and departure small ceremonies, in
whatever form the metaphor suggests, because a population that visibly changes feels alive where
one that pops in and out does not.

## The structure underneath

Four layers, kept honestly separate. This part never changes.

1. **A reader** finds the agent's sessions on disk and normalises them into one thread shape.
   Knows nothing about rendering, and is the only layer that differs per agent —
   `references/harness-adapters.md` has the interface and the rules for touching somebody's real
   work safely.
2. **A mapper** turns the thread list into world state.
3. **A renderer** draws it fast enough that hundreds of inhabitants cost nothing at rest.
4. **A thin server** serves the page, exposes the reader, and hands a thread back to its agent.

Poll the reader, diff against what is on screen, add and retire inhabitants accordingly. The world
is a pure function of the thread list plus a little persisted memory about where things live.

Two invariants inside that:

**One instanced draw for the whole crowd.** Skeletal animation is per-character by default in
every engine: one skinned mesh bound to one skeleton, evaluated on the CPU each frame. Hundreds of
threads then means hundreds of draw calls and hundreds of skeletons stepped every frame, which is
where this kind of project usually dies.

Bake the animation instead. Sample every clip once at load, write each frame's bone matrices into
a texture, give each instance a single number — the frame it is on — and do the skinning in the
vertex shader, upstream of whatever the engine uses to place instances, so the skinned vertex
still gets the per-instance transform. The crowd becomes one draw whether there are six of them or
six hundred.

In three.js that means skinning before `instanceMatrix` is applied rather than letting
`SkinnedMesh` and `Skeleton` do it; other engines have their own name for the same seam, and the
thing to search for is animation-texture or vertex-animation-texture instancing. This is
architectural and painful to retrofit, so do it from the first inhabitant, whatever species it
is.

**One writer for anything persisted.** The page owns the world-state file and writes it whole; the
server only touches the agent's own records. If both write it, a save from a page holding older
state silently drops every change made since that page loaded.

## Build in this order

Each step makes the next easier to judge, and the temptation is always to start at step five.

1. **The reader alone, printed to a terminal.** No graphics. Real session directories are messier
   than anyone expects, and everything downstream is shaped by what is actually there.
2. **The world, empty.** Ground, sky, camera. Get the camera right here; it is used for the whole
   rest of the build.
3. **Territories and the layout rule**, on fake data — much easier before anything moves.
4. **Structures**, still fake.
5. **Inhabitants, instanced from the first one.**
6. **States and behaviour**, then navigation, then interaction, then settings, then polish.

## Verify with numbers

This kind of project fails quietly — something clips a wall once every few minutes, a path is
subtly wrong, an effect is imperceptibly stronger on one machine. Instrument it:

- Paths run, and how many crossed something solid. Target zero.
- Frames simulated per inhabitant, and how many penetrated geometry. Target zero.
- How many settled, and the closest approach between any two.
- Draw calls at rest with the full population on screen.
- Cost in milliseconds of each post-processing pass, measured with a GPU sync rather than
  wall-clock guesswork.

When changing something visual, render the same frame before and after and diff the pixels. A
static scene that differs between frames is a bug, and a diff catches it when eyes will not.

## References

- `references/making-it-feel-alive.md` — the ambience and interaction catalogue, written to be
  translated into any metaphor. Read it while designing behaviour.
- `references/rendering-traps.md` — the graphics problems, roughly in the order they arrive, with
  the reasoning. Read before writing the renderer.
- `references/harness-adapters.md` — reading a coding agent's sessions, the normalised thread
  shape, and how not to damage anyone's work.
- `references/asset-pipeline.md` — decent models without an artist, and the animation-retargeting
  step that is easy to miss.
