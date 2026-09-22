# Tabi

<img src="icons/Tabi128.png" alt="Tabi icon" width="96" height="96">

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
Development requires Node.js 24+; packaging also requires PowerShell 7 (`pwsh`).

```powershell
npm test
npm run check
npm run package
```

Load the repository folder from `brave://extensions` or
`chrome://extensions`. Packaging writes the store ZIP to `dist/`.

## Install

Download `tabi-*.zip` from [Releases](https://github.com/JamesMDon/Tabi/releases/latest)
& extract it to a permanent folder. Open `brave://extensions` or
`chrome://extensions`, enable **Developer mode**, select **Load unpacked**, &
choose the extracted folder containing `manifest.json`.

Shortcut conflicts can be resolved at `brave://extensions/shortcuts` or
`chrome://extensions/shortcuts`. Enable **Allow in incognito** in the extension's
details if you want to tidy incognito windows.

## Releases

Update both versions in `manifest.json` & `package.json`, merge the change, then
push a matching `vX.Y.Z` tag. CI validates & packages that exact revision before
creating a draft GitHub release with the ZIP & its SHA-256 checksum. Review the
draft's notes & package before publishing. Store submission remains manual.

## Privacy

Tab URLs are processed locally when Tabi runs. Nothing is stored or sent. See
[PRIVACY.md](PRIVACY.md).

## Author

[James M. Don](https://github.com/JamesMDon)

## License

[MIT](LICENSE)
