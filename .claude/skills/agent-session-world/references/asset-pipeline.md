# Asset pipeline

You can build a good-looking world without an artist by leaning on CC0 model kits and doing the
work in a packer. The goal is that everything the renderer loads is already merged, already
sharing one atlas, and already retargeted onto one skeleton.

## Choose kits that share a texture

The property that matters is not polygon count, it is whether every model in the pack samples
**one** texture. A kit built around a single gradient atlas means a nine-part building still
merges to one geometry and one draw call. A kit with a texture per model can never do that.

Modularity is the second thing to look for: if a habitat is a base module with a roof module on
it, ten building recipes fit on one screen instead of ten bespoke meshes.

## Atlas cell indices are a naming system

If the atlas is a grid of flat swatches, then "cell 11" is a stable name for a material, and the
shader can act on it. That single idea buys you three things without extra textures, materials
or draw calls:

- **Repaint one swatch per instance.** Swap the hue of the trim cell while keeping the swatch's
  own light-to-dark gradient, and every building wears its owner's accent colour.
- **Light one swatch after dark.** The window cell emits at night; nothing else does.
- **Give a flat texture real PBR.** Look up roughness and metalness *per cell*, so one merged
  geometry holds painted panel, brushed metal and glass and each behaves correctly.

A 32-entry mask uploaded as a uniform array is enough to drive all of this — shaders index it by
cell rather than sampling a second texture, which keeps the whole idea to a few hundred bytes.

To find which cells a model actually uses, average each triangle's UVs and bucket them into the
grid. Worth writing as a throwaway script the first time you meet a kit; you will refer to its
output constantly afterwards.

## Retarget animations onto one skeleton

This is the step that is easy to miss and produces the most confusing failure.

Merging glTF documents brings each animation file's *private copy of the rig* along with it. The
result loads without a single warning and renders the entire character frozen in its bind pose,
because the clips are driving skeletons nobody is looking at.

So: keep one skeleton, and rewrite every animation channel to target *its* bones by name. Report
how many channels retargeted and how many were dropped for having no matching bone — a sudden
change in that ratio is how you notice a pack updated its naming.

While you are there, keep only the clips you actually play. Packs ship many; a project needs a
dozen or so.

## Pack selectively

Kits ship every model in several sizes and colour variants. Take a handful of silhouettes and
get variety from per-instance scale and rotation instead — packing every variant is several
times the file for no more to look at.

Prefer neutral-painted props where you can. A grey rock takes a per-instance tint to lunar dust
or Martian rust without touching the atlas, so one scatter recipe dresses every setting.

## Draw what a texture cannot be

Some surfaces have to take a runtime colour — a region's ground tinted to whoever owns it — and a
painted texture cannot. Draw those to a canvas at boot instead. Author them neutral grey so the
material's colour multiplies through cleanly, and derive a normal map from the same height field
you drew (see `rendering-traps.md`).

## Check in the built files, not the raw packs

Commit the packed output and gitignore the source packs. A fresh clone then runs with no asset
step at all, and the packer becomes a no-op unless someone re-downloads the sources. Document
where to get them.

**Check the licence of everything, including things you did not end up using.** A paid,
non-redistributable texture sitting in an ignored source folder is still on your disk and one
`.gitignore` edit away from being published. Audit before the repo goes public, and record
provenance for anything that ships.

Note the distinction that matters at release time: code licence and asset licence are usually
different. Say so explicitly, and credit the artists even when the licence does not require it.
