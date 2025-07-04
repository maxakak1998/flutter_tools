---
applyTo: '**'
---

# 🧠 Instructions for Copilot Agency for using PaginationLoadMoreController

```dart
final controller = PaginationLoadMoreController.fresh();

// Example usage in an async function
Future<void> fetchMoreData() async {
  final response = await controller.onLoadMore(
    onLoadMore: (page, limit) async {
      // Perform your API call here, returning an APIListResponse
      // e.g. return MyApiService.fetchItems(page, limit);
      return null; // Replace with actual service call
    },
  );
}

1. Usually it will be placed in `cubit`
2. It will work with `APIListResponse` to manage the Pagination
