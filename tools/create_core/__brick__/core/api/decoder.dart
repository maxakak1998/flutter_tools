abstract class Decoder<T> {
  T decode(Map<String, dynamic> json);
}

num? convertToNum(data) {
  if (data == null) return data;
  return num.tryParse(data.toString());
}

bool convertToBool(data) {
  if (data == null) return false;
  if (data == 1 || data == "1") return true;
  if (data is bool) return data;
  return false;
}
