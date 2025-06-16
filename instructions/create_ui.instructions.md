---
applyTo: '**'
---

# 🧠 GitHub Copilot Instructions for UI Code Generation (Flutter + Figma)

### 🔧 UI Code Generation Prompt – Flutter + Image + Figma Integration

1. **Analyze the UI Image**

   * Carefully review the provided image to understand the layout, visual hierarchy, and structure.

2. **Break Down Components**

   * Identify reusable UI elements (e.g., buttons, badges, cards, tabs).
   * Group elements logically and consider widget modularity.

3. **Understand the Target File from Prompt**

   * Extract the screen path from the instruction (e.g., `Create a new widget in home_screen.dart`)
     → This maps to: `lib/features/home_page/presentation/screen/home_screen.dart`.

4. **Edit or Append Code to Target File**

   * Open the identified Dart file and integrate the new widget appropriately.

5. **Write the Widget Code**

   * Use clean, semantic Flutter layouts (`Row`, `Column`, `Container`).
   * Match the image design in functionality and style.

6. **Extract Complex/Reusable Widgets**

   * Place reusable components in:
     `lib/features/<feature_name>/presentation/widgets/`.

7. **Use `base_theme.dart` for Styling**

   * **Do not inline styles.** Instead, apply styles from the active theme instance:

     ```dart
     ITheme currentTheme = GetIt.I<MainAppCubit>().currentTheme;
     ```
   * Refer to `NormalTheme` or other sub-classes for proper implementation.
   * Follow all guidance in `styling.instructions.md`.

8. **Handle Widget Lifecycle Properly**

   * If the widget is stateful, implement `dispose()` to clean up controllers/resources.

9. **Infer Widget States**

   * Adjust styles/appearance based on UI state indicators (e.g., selected tab styling).

10. **Use Asset Placeholder Paths**

    * If an image or asset is present, use `ImageExtension` with a **fake placeholder path**.
      *Do not guess or generate asset content.*


---

**Rules**
 1. Avoid `Stack`, `Positioned`, `Align` unless necessary for overlays
 2. All styles must comply with `styling.instructions.md`
 3. Do not use inline styles or assets, create/update asssets path in `lib/commons/constants/app_assets.dart`
 ```dart
 class AppAssets {
    static const String placeholder = 'assets/images/placeholder.png';
    static const String logo = 'assets/images/logo.png';
 }
 ```
 4. Always use `ImageExtension` for Image Assets
 5. Remember to update the `pubspec.yaml` with new assets if needed