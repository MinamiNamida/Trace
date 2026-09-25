# Trace

Trace is a local-first spatial board for learning notes, formulas, images, sketches, named regions, and stories. It uses React, TypeScript, DOM/SVG, KaTeX, perfect-freehand, Zustand, IndexedDB, and Reveal.js.

Run with `pnpm install` and `pnpm dev`. Open the local URL shown by Vite. A Fourier Transform study board is created on first launch; subsequent edits save in IndexedDB. Image files live in a separate IndexedDB asset store rather than the Board JSON.

Use the board title menu to create a blank board or switch between boards saved in this browser.

## Working on the board

- Drag empty board space to select several items. Drag with Space or the Hand tool to pan. Trackpad scroll pans; pinch, mouse wheel, and the zoom controls zoom around the cursor.
- Double-click text, formulas, or frame titles to edit. New text and formulas begin editing immediately. Click elsewhere or press Cmd/Ctrl Enter to finish. Empty new items are discarded.
- Formula editing takes LaTeX source directly and shows a live KaTeX preview.
- Use Frame to drag a named region. A frame stores bounds only, so moving or deleting it leaves all canvas items in place.
- Drag the subtle handle beside a frame title to another frame to create an edge. Select an edge and press Delete to remove it.
- Drop, paste, or pick images. Draw with Pen and remove strokes with Eraser.
- Cmd/Ctrl Z and Cmd/Ctrl Shift Z edit document history. The lower-right arrows navigate camera history.

## Stories and presentation

Open **Story** at the top right. Create an empty story or build one from the current frame order, then add, repeat, remove, or reorder frame steps. A step can use its frame bounds or a captured board viewport. Story steps only reference the Board; no canvas content is copied. You can keep multiple Stories for different explanations, duplicate a Story, or delete one without changing the Board.

Select a step and choose **Reveal** to set items that touch its frame to visible, reveal in order, or hidden. The reveal list controls the order of fragment advances. Choose **Notes** to write speaker notes for that step. Both settings reference existing Board items; they do not make slide copies.

Choose **Present** to run the Story with Reveal.js. Arrow keys or the on-screen controls advance through reveals and steps. Press **S** or choose **Notes** to open the speaker view. Press Esc or choose **Explore** to pan and zoom freely, then resume the current step. The same `BoardRenderer` renders editor and presentation content.

Choose **HTML** in the Story editor to download a standalone presentation with embedded images, formula fonts, Reveal.js, and notes. It opens without a server or account. The print button in Presentation opens a print layout in a new tab; use the browser's print command and select **Save as PDF**. The editor keeps the same spatial layout at every zoom, while details fade at distant zoom levels and frame titles and edges remain visible.

## Demo image attribution

The Fourier study board includes a crop of page 70, “Time shift,” from *Engineering Signal Analysis: From Fourier to filtering: Theory* by Christian Tiberius and Max Mulder, TU Delft OPEN Books, 2026. [Source](https://books.open.tudelft.nl/home/catalog/book/247). Licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The crop removes page margins and later sections; formulas and text are otherwise unchanged.
