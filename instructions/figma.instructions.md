---
applyTo: '**'
---


# 🧠 Instructions for Figma Integration in Flutter Tools


**When working with Figma data via MCP here is some guidance:**

1.To avoid SVG CSS variable issues in the future:\n\n🛡️ **Prevention Strategies:**\n\n1. **Check Downloaded SVGs:**\n   - Always inspect downloaded Figma SVGs for CSS variables (`var(--variable-name)`)\n   - Look for `fill=\"var(--fill-0, #color)\"` patterns\n\n2. **Post-Download Processing:**\n   - Replace CSS variables with actual hex colors immediately\n   - Use the fallback color from `var(--variable, #fallback)` \n   - Example: `var(--fill-0, #111927)` → use `#111927`\n\n3. **Flutter SVG Requirements:**\n   - Flutter's `flutter_svg` doesn't support CSS variables\n   - Only supports direct color values (`#RRGGBB`, `rgba()`, named colors)\n   - Remove unsupported attributes like `style=\"display: block;\"`\n\n4. **Automated Solution:**\n   - Create a script to process Figma SVGs automatically\n   - Use regex to find and replace CSS variables\n   - Add to build process if extracting many assets\n\n5. **Testing Process:**\n   - Always test icon display after downloading from Figma\n   - Check both light and dark themes if applicable\n\n✅ **Working Pattern:**\n```bash\ncurl -o icon.svg \"figma-url\" && sed -i 's/var([^,]*,\\s*\\([^)]*\\))/\\1/g' icon.svg\n```\n\nThis prevents the \"invisible icon\" issue we just fixed! 🎯
2.Download the actual assets instead of creating your own
```curl
curl -o /Users/mac/Documents/AC_Project/upcoz-mobile/assets/images/common/phone_icon_figma.svg "http://localhost:3845/assets/d5ea2026a3aba03fd061345a5168ed69d23a7166.svg"
```



