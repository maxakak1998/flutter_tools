---
applyTo: '**'
---


# 🧠 Instructions for Figma Integration in Flutter Tools


**When working with Figma data via MCP here is some guidance:**


1.Download the actual assets instead of creating your own
```curl
curl -o /Users/mac/Documents/AC_Project/upcoz-mobile/assets/images/common/phone_icon_figma.svg "http://localhost:3845/assets/d5ea2026a3aba03fd061345a5168ed69d23a7166.svg"
```
You must to download all the assets in batch using a single command
2. Here is the steps you should call MCP
 1. Calling `get_code` tool with language is in plain HTML + CSS , it will generate the codes for that UI and help you have a better understanding of the UI structure and components.
 2. Calling `get_variable_defs` to get the variables and styles used in the UI
 3. Calling `get_image` to get all the assets linked in the UI. Read the `*Check Downloaded SVGs*` section below for more details. Ideally, you should download in batch for all assets in the UI.
 4. Assets should be downloaded to `assets/images/{{feature_name}}/` folder. If the folder does not exist, create it.
 5. Just create a raw UI, do not interact with `Cubit`



 **Check Downloaded SVGs:**
   - Always inspect downloaded Figma SVGs for CSS variables (`var(--variable-name)`)\n   - Look for `fill=\"var(--fill-0, #color)\"` patterns
   2. **Post-Download Processing:**\n   - Replace CSS variables with actual hex colors immediately\n   - Use the fallback color from `var(--variable, #fallback)` \n   - Example: `var(--fill-0, #111927)` → use `#111927`
   3. **Flutter SVG Requirements:**   - Flutter's `flutter_svg` doesn't support CSS variables\n   - Only supports direct color values (`#RRGGBB`, `rgba()`, named colors)\n   - Remove unsupported attributes like `style=\"display: block;\"`
   4. **Automated Solution:**\n   - Create a script to process Figma SVGs automatically\n   - Use regex to find and replace CSS variables\n   - Add to build process if extracting many assets
   5. **Testing Process:**\n   - Always test icon display after downloading from Figma\n   - Check both light and dark themes if applicable
   ✅ **Working Pattern:**\n```bash\ncurl -o icon.svg \"figma-url\" && sed -i 's/var([^,]*,\\s*\\([^)]*\\))/\\1/g' icon.svg\n```
   This prevents the \"invisible icon\" issue we just fixed! 🎯

