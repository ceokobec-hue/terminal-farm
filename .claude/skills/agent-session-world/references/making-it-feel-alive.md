# Making it feel alive

The mechanics get you a world that is correct. This is the list that makes it one somebody wants
to leave open on a second monitor. Take what fits; the point is to be generous here, because this
is where the difference between a dashboard and a place actually lives.

Everything below is written in terms of *inhabitants* and *territories* rather than any
particular creature. Translate it into whatever metaphor was agreed — a fish rising to the glass,
a rabbit standing on its hind legs and a robot waving are the same idea wearing different clothes,
and the reasoning behind each one survives the change.

## Contents

- [Signals you can read from across the map](#signals-you-can-read-from-across-the-map)
- [Rituals](#rituals)
- [Identity and recognition](#identity-and-recognition)
- [Ambient life](#ambient-life)
- [Ways to look](#ways-to-look)
- [Reactive world](#reactive-world)
- [Sound](#sound)
- [Deeper interaction](#deeper-interaction)
- [Restraint](#restraint)

## Signals you can read from across the map

The single most useful thing this world can do is tell you, without being read, that something
wants you.

**Something unmistakable over any inhabitant waiting on a reply.** Tall, coloured distinctly from everything
else, visible at any zoom and through buildings. Everything else can be subtle; this cannot.

**A "fly to the next one waiting" key.** Beacon plus jump-to is the pairing that turns the world
from a decoration into something you actually use. Cycle in the order things started waiting.

**Counts somewhere permanent** — how many working, waiting, stuck — so a glance at a corner answers
"is anything on fire" without moving the camera.

**Colour-code by state, not by project.** Project identity is carried by *place*, which is the
whole point of laying things out spatially. Spend colour on state instead, where it does work.

## Rituals

Populations that pop in and out feel like data. Populations that arrive and leave feel alive.

**Arrival.** A new thread's inhabitant comes in from somewhere specific — a transport that lands, a
gate, the open water, the treeline. It then makes its way to its project's ground. You learn the shape of "something new started"
without reading anything.

**Departure.** Archiving sends the inhabitant back the way it came. The world visibly loses a
resident. It also makes archiving feel like a decision rather than a delete.

**Growth.** When a project gains enough threads to claim more ground, let the new ground appear
alongside the old rather than teleporting the whole zone. Buildings rising out of the ground as
threads begin work is the same idea at a smaller scale.

**Celebration.** When a thread finishes or a pull request merges, make it visible from a distance —
confetti, a flare, a leap, neighbours turning to look. Good news should be legible from
the overview, and it is the one moment where a bit of excess is right.

## Identity and recognition

**Deterministic appearance from the thread id.** Colour, markings, size, accent — all hashed,
never random. The same thread looks the same every time the world is opened, and people start
recognising the long-running ones. This costs almost nothing and does an enormous amount, in any
metaphor.

**Expressions as a mask, not as geometry.** Whatever carries emotion — a face, a screen, an eye
spot, a posture — draw every variant once into an atlas as a white-on-black mask and colour it per
inhabitant at draw time. One texture then gives every individual its own colouring, and switching
expression becomes a single number per instance rather than a mesh swap.

**Blink on independent clocks.** A crowd blinking in unison is instantly, uncannily wrong.

**Name plates that fade in on hover**, and stay visible for anything that wants attention. Nameless
by default keeps the overview clean; naming everything turns it into a spreadsheet with hills.

## Ambient life

**Idle inhabitants potter.** Short wander legs around their own ground, pausing, looking around. Vary
the pace and the pauses per individual.

**Dormant things stay put.** Something that settled because its thread went stale should not get
up, move two metres and settle again every few seconds. The only thing that should shift it is
being pushed out of whatever is standing on it.

**Crowds, not piles.** Inhabitants push each other apart. Space them by the widest part of the model —
holding a crowd tighter than its widest part is a crowd standing inside itself.

**Attention.** Turn toward the camera on hover, toward a neighbour that just celebrated, toward
whatever is being worked on. Anything that looks *at* something reads as aware.

**A prop for the working state.** A tool in hand, something carried, a mouthful of material. It
reads as *working* from far enough away that nobody needs to zoom in to take the temperature of the
map, and it is worth more than a better model. Swap it with the state where the metaphor allows.

**Work that leaves traces.** Sparks while hammering, dust where someone is walking, a glow from a
window that is lit because that thread is active right now.

**Traffic** moving between territories on its own errands — vehicles, birds, shoals, carts. They carry no information and
that is fine — they are there so the world is never completely still.

## Ways to look

The same world at different scales should feel like different things. That is most of the appeal,
and it is nearly free once the world exists.

**Overview** — the whole map, all projects, the beacons. This is the working view.

**Ground level** — down among the inhabitants, where expressions, props and structure detail live. Worth
making reachable in one gesture.

**Follow-cam** — lock to a single inhabitant and watch it work. Surprisingly compelling, and a natural
thing to want after clicking one.

**Photo mode** — hide every panel, keep the world. Pair it with a screenshot key. People will share
these, which is the cheapest distribution a project like this can get.

**Orbit mode** — a slow automatic sweep for when you are not driving. Make it yield instantly when
you touch the camera and ease back in a couple of seconds after you stop.

## Reactive world

Things that respond to real state, rather than running on timers, repay the effort because people
notice the correlation and it makes the world feel *connected* to their work.

**Activity drives ambience.** A project where several threads are running could be visibly busier —
more particles, more light, more movement — than one nobody has touched in days.

**Light the world by real time of day**, as an option. Opening it at 11pm to a dark map with lit
windows lands differently to a fixed noon.

**Theme ground by project.** Terrain, palette or props derived from something stable about the
project — its primary language, its age, its size. It gives each zone a character beyond a colour,
and it is a data change rather than a code change if worlds are already presets.

**Weather.** Dust devils, drifting particulates caught in the light, foliage that moves. Cheap, and
it removes the last of the diorama stillness.

## Sound

Off by default, and worth having.

A low ambient bed. Faint work sounds near whatever is working. One distinct, non-annoying sound
for "somebody needs you" — the only event that should ever interrupt.

The bar is high: audio in an always-open window is either excellent or immediately muted forever.
If in doubt, ship it muted and let people find it.

## Deeper interaction

Once clicking an inhabitant works, these are the natural next asks:

- **Act from the card.** Open the thread in its agent; archive it. Two actions, both obvious.
- **Jump between related things.** Click a territory to see its threads; click a thread to fly to
  its inhabitant.
- **Search.** Type a project or thread name and fly there.
- **A minimap or compass** once the world is bigger than a screen.
- **Filters** — show only what is waiting, only one project, only today.
- **Timeline scrubbing**, if you keep history: watch the day play back, projects lighting up and
  going quiet. This is a large feature and an extremely good one.

## Restraint

Two failure modes to steer away from, both of which come from enthusiasm rather than neglect.

**Do not signal everything.** The moment everything has a badge, the one that matters is invisible.
Most threads are idle; let idle be silent.

**Do not let decoration lie.** Every visible property should be driven by something real, or clearly
be scenery. A building that is tall because tall looks good, sitting next to one that is tall
because that thread did a lot of work, means neither can be read. When in doubt, make it scenery and
put it somewhere the data never goes.

The world should be pleasant when nothing is happening. That is the actual design target, and it is
easy to lose while adding features that are individually good.
