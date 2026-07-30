# Tabi

Tabi makes tabs tidy! :>

Click the icon or press **Alt+T** to:

- merge browser windows into the current window;
- remove exact duplicate URLs;
- sort tabs by URL; and
- preserve the active tab and pinned state.

Regular and incognito windows stay separate. Tabs without an available URL are
never removed as duplicates. Tab groups are flattened because all tabs are
sorted together. Popup tabs are moved when the browser supports it; otherwise,
normal web URLs are reopened before the original popup is closed.

## Development

Tabi is a Manifest V3 extension with no dependencies or network requests.

```powershell
npm test
npm run check
npm run package
```

Load the repository folder from `brave://extensions` or
`chrome://extensions`. Packaging writes the store ZIP to `dist/`.

## Privacy

Tab URLs are processed locally when Tabi runs. Nothing is stored or sent. See
[PRIVACY.md](PRIVACY.md).

## Author

[James M. Don](https://github.com/JamesMDon)

## License

[MIT](LICENSE)
