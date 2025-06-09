import '../../../../../app_export.dart';


class {{feature.pascalCase()}}Screen extends StatefulWidget {
  const {{feature.pascalCase()}}Screen({super.key});

  @override
  State<{{feature.pascalCase()}}Screen> createState() => _{{feature.pascalCase()}}ScreenState();

}

class _{{feature.pascalCase()}}ScreenState extends State<{{feature.pascalCase()}}Screen> {
  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: Text('Hello World'),
      ),
    );
  }
}