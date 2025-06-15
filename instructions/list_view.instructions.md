---
applyTo: '**'
---


# 🧠 Instructions for Copilot Agency how to use ListView

This is a custom list view that is used in the app, it has some features like pull to refresh, load more, and find child key.
You should priotize using this custom list view instead of the default ListView in Flutter.
Here is the common pattern
```dart
CustomListView<RaceAI>(
         ///ScrollController 
          controller: _controller,
          ///ScrollNotifierController, it will work with ScrollNotifier
          ///If we have the feature to load more data, we should use this controller
          refreshController: _refreshController,
          data: races,
          ///This is helpful method to refresh the data after a certain time.
          refresh: (
            onDone: (refreshController) {
               fetchRaces(isRf: true);
            },
            after: Duration(
                minutes: 5)
          ),
          padding: EdgeInsets.only( top: 10.sp, bottom: ScreenUtil().bottomBarHeight,left: 14.sp, right: 14.sp),
          separatedWidget: (i, c) => SizedBox(
                height: 16.sp,
              ),
          notFoundWidget: Icon(
            Icons.hourglass_empty,
            size: 32,
            color: styles.aiBettingStyle().getPrimaryColor(1),
          ),
          ///When the user pulls down to refresh, it will call this method
          onRefresh: () {
            ///the return value should be:
            /// a Future of List
            /// or a Future of null or empty list if no data is returned
            return fetchRaces(isRf: true);
          },
          ///When the user reaches the bottom of the list, it will call this method
          onReachBottom: () {
                    ///the return value should be:
            /// a Future of List
            /// or a Future of null or empty list if no data is returned
            /// It's important to return a Future of void if the data is not changed
            return fetchRaces(isLm: true);
          },
          ///If the data has its unique id, better to use it 
          findChildKey: (key) => key is ValueKey
              ? races?.indexWhere((element) =>
                  element.meetingId.toString() == key.value.toString())
              : null,
          itemBuilder: (e, i, c) => 
              AIRaceItem(
                    key: ValueKey(e.meetingId),
                    data: e,   
                    onTap: (StatusType type, data) {
                      onTap(type, data, e);
                    },
                  ));
```