# GIMP Workflow Guide: Bashability Logo Preparation

A quick-reference cheat sheet for standardizing, scaling, and exporting team logos (like the Seals, Landsharks, and others) for the Bay Area Street Hockey website.

---

## 1. The Master Canvas Workflow (Standardizing Logo Sizes)
*Use this to ensure all team crests visually match in proportion and weight.*

1. **Create Target Canvas:** `File > New` (e.g., 500x500px). Set *Fill with* to **Transparency**.
2. **Set Guides:** `Image > Guides > New Guide (by Percent)`. Set at 5% and 95% (horizontal and vertical) for a safe zone.
3. **Import All:** `File > Open as Layers...` (`Ctrl + Alt + O`) and select all logos.
4. **Scale:** Select a layer, press `Shift + S`. 
   * **Crucial:** Ensure the **Chainlink Icon** (in the pop-up or Tool Options) is **Locked** (solid line) so the logo doesn't warp.
5. **Center:** Press `Q` for the Alignment Tool. Click the logo, then click **Align Center of Target** and **Align Middle of Target**.
6. **Repeat:** Hide/unhide layers to visually match their visual weight, scaling and centering each one.

## 2. Scaling Non-SVG Raster Images (Avoiding Blur)
*Use this when scaling PNGs or JPGs up or down.*

1. **Set Interpolation:** Before hitting "Scale", go to your Tool Options panel.
   * **NoHalo:** Use when scaling *down*, or for crisp edges/solid colors.
   * **LoHalo:** Use when scaling *up*, or for gradients/photographic elements.
2. **Apply Sharpening (If scaling up):** Go to `Filters > Enhance > Sharpen (Unsharp Mask)`.
   * *Recommended start:* Radius 1.0 - 1.5, Amount 0.50. Tweak until edges are crisp but not grainy.

## 3. Working with Backgrounds & The Magic Wand
*Use this to remove white backgrounds or recolor specific logo sections.*

1. **Enable Transparency:** Right-click the image layer > **Add Alpha Channel** (skip if greyed out).
2. **Select Area:** Press `U` for the **Fuzzy Select Tool** (Magic Wand) and click the target color/area.
3. **Make Transparent:** Press `Delete`. Look for the grey checkerboard pattern.
4. **Recolor Area:** Click the Foreground Color swatch to pick a new color. Press `Shift + B` (Bucket Fill) and click inside the selected area.
5. **Clear Selection:** `Select > None` (`Shift + Ctrl + A`).

## 4. Proper Export Settings
*Use this to ensure your logos actually have transparent backgrounds on the website.*

1. **Hide the Background Layer:** In the Layers panel, click the **Eye Icon** next to any solid bottom layer (usually named "Background"). You *must* see the checkerboard pattern behind your logo.
2. **Export as PNG:** Go to `File > Export As...` (`Shift + Ctrl + E`).
3. **Name it:** Ensure the filename ends in **.png** (JPEGs will ruin the transparency and turn the background white).
4. **Save:** Click Export, leave the pop-up settings on default, and click Export again.
