# Mobula font package manifest

Manifest version: `mobula-fonts-1`

| Role | File | SHA-256 | Coverage contract |
| --- | --- | --- | --- |
| Interface | `AtkinsonHyperlegibleNext-Latin.woff2` | `18b2a1a39a2fa298b0ba5390aca68462669826c90925656f1c1f6796e0e1bbaf` | Latin application labels and prose |
| Data | `MartianMono-Width100-Latin.woff2` | `bb677c9c5cf5b384b5e4a1fd86755a47e0cbafe6bc70a9ba458b5e13e1d7a5c0` | Latin identifiers, ASCII digits, coordinates, timestamps, arrows, and U+2212 minus |
| Math | `STIXTwoMath-Regular.woff2` | `094191335def3f0452c81ec0713cfc2f29bb6af8cecbf79b60881fbf2db97562` | Greek and scientific notation listed below |

The required math/science glyph set is:

- Greek: `α μ ν π σ` (`U+03B1`, `U+03BC`, `U+03BD`, `U+03C0`, `U+03C3`)
- units and operators: `° ′ ″ − ± × ·` (`U+00B0`, `U+2032`, `U+2033`, `U+2212`, `U+00B1`, `U+00D7`, `U+00B7`)
- superscripts: `⁰ ¹ ² ³ ⁻` (`U+2070`, `U+00B9`, `U+00B2`, `U+00B3`, `U+207B`)
- astronomy: `☉ ⊕` (`U+2609`, `U+2295`)

Mathematical glyphs must be wrapped in the `mathGlyph` role. The Latin
interface and data subsets must not silently own or provide fallback for Greek
notation. All three families use `font-synthesis: none`.

The accompanying `OFL-*.txt` files contain the licenses for each font family.
