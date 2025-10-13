````instructions
---
applyTo: '**'
---


# 🧠 Instructions for Figma Integration in Flutter Tools

## 📌 Linking Widgets/Screens to Figma

**ALWAYS add `@FigmaLink` annotation to widgets and screens:**
3
> ℹ️ If the developer shares the Figma URL in chat (instead of already having it in the file), treat it exactly the same: use that URL when creating or updating the widget and add the complete `@FigmaLink` annotation yourself.

```dart
import 'package:upcoz_flutter/core/annotations/figma_link.dart';

@FigmaLink(
  url: 'https://www.figma.com/design/Q1iF5BerghqTpPEXOb0Y2x/UPC-NEW-HOST?node-id=4733-12025&t=lYKrrkpCUmuOfHOh-4',
)
class LoginScreen extends StatelessWidget {
  // Widget implementation
}
```

### Developer Usage:
- **Required**: Provide the `url` with Figma node-id
- **Optional**: Add `prompt` field with instructions for Copilot when generating code

```dart
@FigmaLink(
  url: 'https://www.figma.com/design/...',
  prompt: 'Make the button more accessible with larger touch targets', // Optional
)
```

### Copilot Behavior:
When you fetch UI code from Figma using MCP tools:
1. **Read the `prompt`** field and use it as additional context for code generation
2. **Auto-fill `componentName`** from Figma metadata after fetching
3. **Auto-fill `lastUpdated`** with current DateTime when generating/updating code
4. **If the URL comes from chat**, include it in the `@FigmaLink` annotation even if the original file didn't have one
5. **Break complex layouts into annotated parts**: when a widget builds multiple logical sections (e.g. `_buildHeader()`, `_buildActions()`, two buttons, or cards), extract those sections into their own widgets (or helper methods that return widgets) and annotate each with an `@FigmaLink` that points to the most specific Figma node. This keeps each piece independently maintainable.

#### Example: annotating child sections

```dart
class FeatureScreen extends StatelessWidget {
  const FeatureScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: const [
        HeroSection(),
        SizedBox(height: 16),
        ActionButtons(),
      ],
    );
  }
}

@FigmaLink(
  url: 'https://www.figma.com/design/...node-id=123',
  componentName: 'Hero Section',
  lastUpdated: DateTime(2025, 10, 9),
)
class HeroSection extends StatelessWidget {
  const HeroSection({super.key});

  @override
  Widget build(BuildContext context) {
    // ...
  }
}

@FigmaLink(
  url: 'https://www.figma.com/design/...node-id=456',
  componentName: 'Primary CTA Buttons',
  lastUpdated: DateTime(2025, 10, 9),
)
class ActionButtons extends StatelessWidget {
  const ActionButtons({super.key});

  @override
  Widget build(BuildContext context) {
    // ...
  }
}
```

> ✨ By annotating each part, you can regenerate just the header or a single button without disrupting the surrounding layout.

### When to Use @FigmaLink:
✅ **All screens and pages**
✅ **Reusable custom widgets** (buttons, cards, inputs)
✅ **Design system components**
✅ **Complex UI components**
✅ **Feature-specific widgets**

### Benefits:
- 🔗 Direct link from code to design
- 🤖 Custom prompts guide Copilot's code generation
- 📚 Auto-generate component documentation
- 🔍 Quick design reference for developers
- ✅ Maintain design-code consistency
- 📊 Track which designs need updates (via lastUpdated)

---

## 🎨 Generating UI from Figma (MCP)

**When working with Figma data via MCP here is some guidance:**


1.Download the actual assets instead of creating your own
```curl
curl -o /Users/mac/Documents/AC_Project/upcoz-mobile/assets/images/common/phone_icon_figma.svg "http://localhost:3845/assets/d5ea2026a3aba03fd061345a5168ed69d23a7166.svg"
```
You must to download all the assets in batch using a single command
2. Here is the steps you should call MCP
 1. Calling `get_code` tool , it will generate the codes for that UI and help you have a better understanding of the UI structure and components.
 2. Calling `get_variable_defs` to get the variables and styles used in the UI
 3. Calling `get_image` to get all the assets linked in the UI. Read the `*Check Downloaded SVGs*` section below for more details. Ideally, you should download in batch for all assets in the UI.
 4. Assets should be downloaded to `assets/images/{{feature_name}}/` folder. If the folder does not exist, create it.
 5. Just create a raw UI, do not interact with `Cubit`
 6. **ALWAYS add `@FigmaLink` annotation** to the generated widget/screen:
    - Set `url` field with the Figma URL (including node-id)
    - If there's a `prompt` in the existing annotation, **use it as additional context** for code generation
    - **Auto-fill `componentName`** by extracting the layer/component name from Figma
    - **Auto-fill `lastUpdated`** with the current DateTime

Example:
```dart
@FigmaLink(
  url: 'https://www.figma.com/design/Q1iF5BerghqTpPEXOb0Y2x/UPC-NEW-HOST?node-id=4733-12025',
  componentName: 'Login Screen',  // Auto-filled from Figma
  lastUpdated: DateTime(2025, 10, 8),  // Auto-filled with current date
)
class LoginScreen extends StatelessWidget {
  // ... generated code
}
```



 **Check Downloaded SVGs:**
   - Always inspect downloaded Figma SVGs for CSS variables (`var(--variable-name)`)\n   - Look for `fill=\"var(--fill-0, #color)\"` patterns
   2. **Post-Download Processing:**\n   - Replace CSS variables with actual hex colors immediately\n   - Use the fallback color from `var(--variable, #fallback)` \n   - Example: `var(--fill-0, #111927)` → use `#111927`
   3. **Flutter SVG Requirements:**   - Flutter's `flutter_svg` doesn't support CSS variables\n   - Only supports direct color values (`#RRGGBB`, `rgba()`, named colors)\n   - Remove unsupported attributes like `style=\"display: block;\"`
   4. **Automated Solution:**\n   - Create a script to process Figma SVGs automatically\n   - Use regex to find and replace CSS variables\n   - Add to build process if extracting many assets
   5. **Testing Process:**\n   - Always test icon display after downloading from Figma\n   - Check both light and dark themes if applicable
   ✅ **Working Pattern:**\n```bash\ncurl -o icon.svg \"figma-url\" && sed -i 's/var([^,]*,\\s*\\([^)]*\\))/\\1/g' icon.svg\n```
   This prevents the \"invisible icon\" issue we just fixed! 🎯

