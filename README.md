About
-------------------------------
quiver2bookmark is a node package that extracts bookmarks from Quiver.app data by converting all the text cell web links in a quiver library to a Netscape bookmarks file that is importable to Chrome, Safari, Firefox, and other browsers.

Install
-------------------------------

Install with npm.

```shell
npm install -g quiver2bookmark
```

Usage
-------------------------------

quiver2bookmarks [args]

```
--out, -o          Required - The output file to write.
--prune, -p        Remove empty notebooks and notes from the output.
--resolve, -r      Resolve each bookmark title by scraping the URL and finding the <title> tag.
                   The resolve cache file is/will be stored at: ~/Library/Containers/com.happenapps.Quiver/Data/Library/Application Support/Quiver/quiver-bookmarks-titles.json
--help, -h         Print this help message.
```

License
-------------------------------
MIT
