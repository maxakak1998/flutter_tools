# 🧠 Copilot Agency – iOS to Flutter Cloning Instructions

## Purpose

These instructions ensure that when converting or cloning UI and logic from the iOS project to Flutter, the **original iOS UI style and structure are strictly preserved**.  
**Do not attempt to redesign, reinterpret, or "improve" the UI.**  
**Stick to the exact UI style, layout, and behavior as implemented in the iOS project.**

---

## 1️⃣ Full iOS Project Structure Reference

Below is a detailed structure of the iOS project (`data-entry-mobile-ios/Data Entry/Data Entry/`).  
Use this as a mapping reference for all conversions.  
**Every folder and file may be important for the conversion process.**

```
Data Entry/Data Entry/
├── API/                        # Networking logic (API clients, endpoints, request/response models)
│   ├── APIClient.swift
│   ├── Endpoints.swift
│   ├── NetworkManager.swift
│   └── ...
├── AppDelegate.swift           # App lifecycle entry point
├── Assets.xcassets/            # Image and color assets
├── Base.lproj/                 # Base localization resources
│   └── LaunchScreen.storyboard
├── Configs/                    # App-wide configs (constants, environment, plist, keys)
│   ├── AppConfig.swift
│   ├── Constants.swift
│   └── ...
├── Info.plist                  # App configuration (bundle id, permissions, etc.)
├── Libraries/                  # Shared libraries/utilities (extensions, helpers, 3rd-party wrappers)
│   ├── Extensions/
│   │   ├── String+Extension.swift
│   │   └── ...
│   ├── Helpers/
│   │   ├── DateHelper.swift
│   │   └── ...
│   └── ...
├── Main.storyboard             # Main UI storyboard (screen navigation/layout)
├── Models/                     # Data models (structs/classes for business and API data)
│   ├── User.swift
│   ├── Form.swift
│   └── ...
├── Resources/                  # Assets (images, storyboards, xibs, localization, fonts)
│   ├── Images.xcassets/
│   ├── Localizable.strings
│   ├── Main.storyboard
│   ├── CustomButton.xib
│   ├── FormFieldView.xib
│   └── ...
├── Supporting Files/           # Supporting files (entitlements, launch images, etc.)
│   ├── Data Entry.entitlements
│   └── ...
├── ViewControllers/            # UI logic (UIViewController subclasses for screens/pages)
│   ├── LoginViewController.swift
│   ├── HomeViewController.swift
│   ├── FormViewController.swift
│   └── ...
└── Views/                      # Custom UI components (UIView subclasses, custom cells, reusable views)
    ├── CustomButton.swift
    ├── FormFieldView.swift
    ├── TableCellView.swift
    └── ...
```

**Notes:**
- `.xib` files in `Resources/` or `Views/` define reusable UI layouts (e.g., custom cells, buttons, fields).
- `Assets.xcassets` and `Images.xcassets` contain all image and color assets.
- `Main.storyboard` and other storyboard files define screen layouts and navigation.
- `Localizable.strings` and `Base.lproj` are for localization.
- `AppDelegate.swift` and `Info.plist` are for app configuration and lifecycle.

---

## 2️⃣ Flutter Clean Architecture Structure Reference

```
lib/
├── commons/               # Shared base utilities (e.g., base_cubit)
├── constants/             # Static constants and keys
├── core/
│   ├── api/               # Network config, clients
│   ├── font/              # Font assets
│   ├── localization/      # Localization setup
│   ├── routers/           # Global route setup
│   ├── services/          # Shared services (e.g., SecureStorageService)
│   └── theme/             # App-wide theme management
├── features/
│   └── <feature_name>/
│       ├── data/          # Data sources, models, repository impls
│       ├── domain/        # Business logic (use cases, interfaces)
│       ├── presentation/  # UI layer (Cubit/Bloc, Pages, Widgets)
│       └── <feature>_inject.dart  # DI setup for the feature
```

---

## 3️⃣ Mapping iOS Folders to Flutter

| iOS Folder/File                | Flutter Location (Clean Architecture)                                                                 |
|------------------------------- |------------------------------------------------------------------------------------------------------|
| API/                           | `lib/core/api/` (global) or `lib/features/<feature>/data/` (feature-specific)                        |
| Configs/                       | `lib/constants/` or `lib/core/` (for app-wide configs)                                               |
| Libraries/Extensions/          | `lib/commons/` or `lib/core/` (for shared utilities/services)                                        |
| Libraries/Helpers/             | `lib/commons/` or `lib/core/`                                                                        |
| Models/                        | `lib/features/<feature>/domain/models/` (business logic) or `data/models/` (API models)              |
| Resources/Images.xcassets/     | `assets/images/` (use `ImageExtension` for asset management)                                         |
| Resources/*.xib                | `lib/features/<feature>/presentation/widgets/` (convert .xib UI to Flutter widget)                   |
| Resources/*.storyboard         | `lib/features/<feature>/presentation/screen/` (convert storyboard screens to Flutter screens)         |
| Resources/Localizable.strings  | `lib/core/localization/` (localization setup)                                                        |
| ViewControllers/               | `lib/features/<feature>/presentation/screen/` (screens/pages), `widgets/` (reusable widgets)         |
| Views/                         | `lib/features/<feature>/presentation/widgets/` (custom widgets/components)                           |
| AppDelegate.swift, Info.plist  | Flutter `main.dart`, `pubspec.yaml`, and platform-specific files as needed                           |
| Supporting Files/              | Platform-specific setup in Flutter (e.g., entitlements, launch images)                               |

---

## 4️⃣ Cloning Rules

1. **Do NOT imagine or invent UI elements.**
   - Only implement what is present in the iOS project.
   - If a UI detail is missing or unclear, ask the developer for clarification.

2. **Strictly follow the iOS UI style.**
   - Colors, fonts, paddings, margins, and component shapes must match the iOS implementation.
   - Use the same icons, images, and assets as the iOS project (see `Resources/`).

3. **Component Mapping**
   - Map each iOS `ViewController` to a Flutter screen in `lib/features/<feature>/presentation/screen/`.
   - Map each iOS custom `UIView` or `.xib` to a Flutter widget in `lib/features/<feature>/presentation/widgets/`.
   - Map iOS models to `domain/models` and `data/models` as per Clean Architecture.

4. **Styling**
   - Extract all styles to the theme system (`base_theme.dart` and its subclasses).
   - Do not inline styles in widgets.
   - Use only fonts and colors defined in the iOS project.
   - If a style is not defined, ask the developer before proceeding.

5. **Assets**
   - Use the same images and icons as in the iOS `Resources/Images.xcassets/` folder.
   - Always use `ImageExtension` for asset management in Flutter.

6. **Layout**
   - Use Flutter layout widgets (`Column`, `Row`, etc.) to match the iOS layout.
   - Avoid using `Stack` unless the iOS UI requires overlapping elements.
   - Do not hardcode sizes unless the iOS project does so.

7. **Responsiveness**
   - Use `screen_util` for responsive sizing, following the suffix conventions (`sp` for font, `h` for height, `w` for width).

8. **No Creative Interpretation**
   - Do not "modernize", "simplify", or otherwise change the UI/UX.
   - If you are unsure how to map a UI element, ask the developer for guidance.

---

## 5️⃣ Real-life Example: Converting a `.xib` Custom View

**iOS:**  
- `Resources/CustomButton.xib` defines the layout and style for a custom button.
- `Views/CustomButton.swift` is the logic for this button.

**Flutter Conversion:**

1. **Widget Location:**  
   - Create `lib/features/<feature>/presentation/widgets/custom_button.dart`.

2. **Widget Implementation:**  
   - Replicate the layout and style from `CustomButton.xib` using Flutter widgets.
   - Extract all style values (color, font, border radius) to the theme system (`base_theme.dart` and its concrete class).
   - Do not inline any style in the widget.

3. **Usage:**  
   - Use this widget wherever the custom button appears in the iOS project.

4. **Asset Handling:**  
   - If the `.xib` references images, place them in `assets/images/` and use `ImageExtension` in Flutter.

**Example Mapping Table:**

| iOS File/Folder                | Flutter File/Folder                                                      |
|------------------------------- |--------------------------------------------------------------------------|
| Resources/CustomButton.xib      | lib/features/<feature>/presentation/widgets/custom_button.dart           |
| Views/CustomButton.swift        | lib/features/<feature>/presentation/widgets/custom_button.dart           |
| ViewControllers/LoginViewController.swift | lib/features/login/presentation/screen/login_screen.dart        |
| Models/User.swift               | lib/features/login/domain/models/user.dart                               |
| API/UserAPI.swift               | lib/features/login/data/datasources/user_api.dart                        |
| Resources/Images.xcassets/logo.png | assets/images/logo.png (use ImageExtension)                          |

---

## 6️⃣ When in Doubt

- **Ask the developer for clarification** before making assumptions about UI, style, or behavior.
- **Never guess or invent UI/UX details.**

---

**Summary:**  
Your job is to clone the iOS project’s UI and logic as faithfully as possible in Flutter, using Clean Architecture and the project’s conventions.  
**Do not imagine the UI—stick to the iOS project’s style and structure, including all `.xib` files and their layouts.**
**Stricly follow other instructions.**


## Steps to Cloning
1. Porting the UI and relevant components from the iOS project to Flutter.
   You should compare sequentially the iOS project structure with the Flutter project structure, and follow the mapping rules to ensure that the UI and logic are cloned accurately
   For example, when you creating the button FLutter widgets, you should indicate how the button is structured in the iOS project.
2. Analyze how the data and apis call are structured in the iOS project.
   You should compare the iOS API and data structure with the Flutter project structure, and follow the mapping rules to ensure that the data and apis are cloned accurately. 
   You should aware if the initital data is loaded from the API/from the local database/from other existing , and how the data is structured in the iOS project.
3. Applying the logic and business rules from the iOS project to Flutter.
   You should compare the iOS logic and business rules with the Flutter project structure, and follow the mapping rules to ensure that the logic and business rules are cloned accurately.
   You should aware how the logic is structured in the iOS project, and how it is applied to the UI components.