# Screenshots

Drop the following PNGs into this folder. The filenames are referenced by the
main README's **Screenshots** section, so keep them exact.

**Capture with Demo Mode ON** (Account Settings → Demo Mode) so no real bankroll
numbers are exposed.

| File | Page | What to capture |
|------|------|-----------------|
| `dashboard.png` | `/` Dashboard | The hero shot — bankroll-over-time chart, 7-day P&L, and the sport-performance section all visible |
| `stats.png` | `/stats` Stats | Cumulative P&L + edge analytics + per-sport / per-bet-type ROI |
| `daily-report.png` | `/report` Daily Report | The WagerTalk-style daily breakdown (Daily view) |
| `line-shop.png` | `/line-shop` Line Shop | The multi-book price table / arbitrage scan |

### Tips for clean shots
- Use a desktop browser at ~1440px width; let charts finish rendering.
- Light or dark mode — just be consistent across all four.
- Crop to the content area (no browser chrome / bookmarks bar).
- Aim for ~1600px wide; PNG keeps charts crisp.

Once the four files are here, commit and push:

```bash
git add screenshots/*.png
git commit -m "docs: add app screenshots to README"
git push
```
