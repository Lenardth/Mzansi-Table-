# Mzansi Table identity

The app badge uses a cream M-shaped dining plate and three orange people on forest green. The identity represents local food and gathering around a table.

- `app-icon.png`: 1024px opaque iOS and standard launcher icon.
- `adaptive-foreground.png`: padded Android adaptive icon foreground.
- `adaptive-monochrome.png`: transparent white symbol for themed Android launcher icons.
- `notification-icon.png`: transparent white 96px notification symbol.
- `splash-mark.png`, `header-badge.png`, `favicon.png`: app and web artwork.
- `mzansi-table-master.png`: original generated artwork.

The master badge was generated with the built-in image generation tool. Final master prompt:

> Use case: logo-brand. Create one production-quality square app icon for Mzansi Table, a South African restaurant reservations and community events app. A distinctive, friendly, premium geometric emblem: a warm ivory round dining plate forming a welcoming open circular table, with three simple terracotta-orange seats / people around it; integrated subtle M-shaped negative space in the plate to suggest Mzansi and togetherness. Bold balanced silhouette readable at 32 pixels, beautifully restrained contemporary hospitality identity. Solid deep forest green background #104c33 extending edge to edge, cream #faf6ee and burnt orange #e3430b mark. Flat vector-like graphic rendered as a crisp raster, no lettering, no words, no tiny details, no gradients, no shadows, no phone mockup, no border, no pre-rounded square corners. Center the complete emblem comfortably within the central 58% of the square with generous safe padding for iOS and Android circular masks. Output a single square 1024x1024 icon.

Transparent AI variations were not used because their edge quality was unsuitable. The monochrome dining symbol is drawn in code for a clean OS mask. Navigation uses the existing Expo Symbols package: SF Symbols on iOS and bundled Material Symbols on Android/web.

Regenerate deployment sizes and monochrome masks with:

```sh
node scripts/prepare-brand-assets.cjs
```

Launcher icons and splash changes appear after rebuilding the native app. In-app icons and the header badge update with the app bundle.

## Primary logo

`mzansi-table-logo.png` is the full 2172×724 horizontal emblem and wordmark. `logo-header.png` is its 1086×362 app-header export. Created with the built-in image generation tool using the existing badge as reference.

Final logo prompt:

> Use case: logo-brand. Design the final horizontal primary brand logo for Mzansi Table, a South African restaurant booking and community gathering app, using the attached app icon as the identity reference. Keep the same recognizable cream M-shaped plate and three orange people emblem, compact on the left. To its right, set the exact words "Mzansi Table" in beautiful large warm ivory typography, a refined friendly contemporary serif with balanced proportions, editorial hospitality character, expertly kerned, extremely readable. One single line of text, Mzansi followed by a space and Table, exactly this capitalization. Emblem and wordmark vertically centered and visually balanced. Solid uniform flat forest green background #104c33 extending edge to edge, cream #faf6ee wordmark and plate, burnt orange #e3430b people. Wide horizontal canvas roughly 3:1 aspect ratio, generous equal padding around the complete lockup, wordmark large enough to dominate the right two-thirds. Crisp polished flat graphic, no texture, no noise, no gradients, no shadows, no tagline, no mockup, no border, no other words. This is a real usable brand logo asset, not a presentation sheet.
