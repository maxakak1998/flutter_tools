import 'manger_service_export.dart';

class FireStoreService extends BaseEnvService {
  FirebaseFirestore firestore;
  FirebaseAuth firebaseAuth;

  FireStoreService({required this.firestore, required this.firebaseAuth});

  @override
  Future<void> init(covariant BaseEnvOptions? options) async {
    /// Initialize FireStore here or related data here
  }
}
