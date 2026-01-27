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
 6. **ALWAYS use `flutter_screenutil` for responsive sizing** - See Responsive Design section below

---

## 📱 Responsive Design (CRITICAL - ScreenUtil)

**ALWAYS use `flutter_screenutil` for responsive sizing. NEVER use hardcoded numeric values.**

### Import Required
```dart
import 'package:flutter_screenutil/flutter_screenutil.dart';
```

### ✅ Correct Pattern
```dart
// Font sizes - use .sp
Text('Hello', style: TextStyle(fontSize: 16.sp))
theme.bodyText.copyWith(fontSize: 14.sp)

// Width - use .w
SizedBox(width: 100.w)
Container(width: 200.w)
EdgeInsets.symmetric(horizontal: 16.w)

// Height - use .h
SizedBox(height: 50.h)
Container(height: 100.h)
EdgeInsets.symmetric(vertical: 12.h)

// Border radius - use .r
BorderRadius.circular(8.r)
RoundedRectangleBorder(borderRadius: BorderRadius.circular(12.r))

// Combined padding
EdgeInsets.fromLTRB(16.w, 12.h, 16.w, 12.h)
EdgeInsets.only(left: 8.w, top: 4.h, right: 8.w, bottom: 4.h)
```

### ❌ WRONG Pattern (DO NOT USE)
```dart
// NEVER use hardcoded values - these will NOT scale properly on different devices
Text('Hello', style: TextStyle(fontSize: 16))  // ❌ Missing .sp
SizedBox(width: 100)  // ❌ Missing .w
SizedBox(height: 50)  // ❌ Missing .h
EdgeInsets.all(16)    // ❌ Missing .w or .h
BorderRadius.circular(8)  // ❌ Missing .r
Container(padding: EdgeInsets.symmetric(horizontal: 20, vertical: 10))  // ❌ Missing suffixes
```

### When to Use Each Suffix
| Suffix | Use For | Example |
|--------|---------|---------|
| `.sp` | Font sizes, icon sizes | `fontSize: 16.sp`, `Icon(size: 24.sp)` |
| `.w` | Horizontal values (width, horizontal padding/margin) | `width: 100.w`, `horizontal: 16.w` |
| `.h` | Vertical values (height, vertical padding/margin) | `height: 50.h`, `vertical: 12.h` |
| `.r` | Border radius | `BorderRadius.circular(8.r)` |