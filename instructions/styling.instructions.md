---
applyTo: '**'
---


# 🧠 Instructions for Copilot Agency

1. When add new styles, remember to create in the abtract class first, and then implement the style in the concrete class, comply with `structure.instructions.md` 
2. We are using the package 'screen_util' to manage the screen size and responsive design. 
With fontSize we will use the suffix 'sp' to indicate that it is a font size, and with height and width we will use the suffix 'h' and 'w' respectively.
3. Working with abstract base_theme.dart and other its sub-classes to implement a new style. 
   Remember dont put the style inside the widget, it should be extracted from the project theme.
4. Avoid overusing Stack in Flutter. Use it only when elements need to overlap. For typical layouts, prefer Column, Row, or other layout widgets to ensure performance and maintainability.
5. Dont add other font when creating a new style, just use the font that is already in the project.
6. When editing/updating the styles for the existing widgets, remember to update the style in the abstract class first, and then implement the style in the concrete class.