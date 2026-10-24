# Khelo website + app screens: design source of truth

These 9 `.dc.html` files are the approved design. Build the web app to match them exactly.

How to read a `.dc.html` file:
- The markup with inline `style="..."` attributes IS the design: layout, spacing, colors, radii, copy.
- `{{name}}` are template holes filled by the script block at the bottom (`renderVals()`).
- `<sc-for list="{{x}}" as="i">` is a loop, `<sc-if value="{{x}}">` is a conditional.
- The bottom `<script type="text/x-dc">` block holds sample data and the interactions (state, click handlers). Sample data is NOT real data.
- Ignore `<script src="./support.js">` and the `<x-dc>` wrapper: they belong to the design tool.
- `<helmet><style>` holds shared CSS (hover effects, focus ring, responsive breakpoints).

File to route map:
| File | Route |
|---|---|
| Main.dc.html | / |
| Features.dc.html | /features |
| Owners.dc.html | /for-owners |
| About.dc.html | /about |
| Blog.dc.html | /blog |
| Contact.dc.html | /contact |
| Login.dc.html | /login |
| Signup.dc.html | /signup |
| Search.dc.html | /search |

`canvas.json` only describes artboard positions in the design tool. Not needed for the build.
