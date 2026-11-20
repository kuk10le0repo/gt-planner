# Sharing GT Planner on GitHub

The app is plain static files, so GitHub Pages can host it for free. Your friends open a link, the recipe data and icons
load automatically, and every person's boards stay in their own browser. Nothing to install on their side.

## What gets published
About 20 files (about 25 MB): the app, `data/dataset.json` (all your recipes and multiblocks in one file), `icons/textures.js`
(every icon in one file), the in-game export scripts (`kubejs/`) and the helper scripts (`tools/`).
It does **not** publish the raw game exports (`dumps/`, 36 MB) or your boards, which only exist in your browser.

## Before you publish: whose files are these?
The recipes come from your modpack (Star Technology) and the icons are textures taken from Minecraft, GregTech CEu and
that pack. Those belong to their authors. A **public** repository republishes them to everyone. Consider:
- keeping the repository **private** and inviting your friends (note: GitHub Pages on a private repository needs a paid
  GitHub plan, so with a free plan you would share the folder as a zip instead), or
- going public but crediting the sources (see the notice in README.md) and removing anything a pack author asks you to.
It is your call; nothing is published until you do it yourself.

## Publish with the website only (no Git needed)
1. Sign in at https://github.com and click **New repository**. Name it (for example `gt-planner`), choose Public or Private,
   leave "Add a README" unticked, click **Create repository**.
2. On the new empty repository page click **uploading an existing file**.
3. Open the `gt-planner` folder on your PC and drag **everything inside it** into the browser, **except** these (they are
   not needed and are listed in `.gitignore`): the `dumps` folder, the `icons\tex` folder, `GTPlanner.exe`.
   You can drag the folders `data`, `icons` (only `index.js` and `textures.js` inside), `kubejs` and `tools` as they are,
   plus the loose files. (GitHub's page accepts up to 100 files per upload, and this project is about 20.)
4. Write a message such as "Add GT Planner" and click **Commit changes**.
5. Go to **Settings -> Pages**. Under "Build and deployment" choose **Deploy from a branch**, branch **main**, folder
   **/ (root)**, and click **Save**.
6. After about a minute the page shows your link: `https://<your-username>.github.io/<repo-name>/`. Send it to your friends.

## Publish with Git instead
Install Git for Windows (or GitHub Desktop), then in the `gt-planner` folder:

```
git init
git add .
git commit -m "Add GT Planner"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```
and do step 5 above. `.gitignore` already leaves out the big and local-only files.

## Updating the data later (new modpack version, more recipes)
1. Re-export from the game (see README) so `dumps/` is fresh.
2. Run `powershell -ExecutionPolicy Bypass -File tools\make_dataset.ps1` (and `tools\build_icons.ps1` if icons changed).
3. Upload the changed files in `data/` (and `icons/textures.js`) to the repository and commit.
Friends who already have the app open the new data automatically the next time they load the page: the app compares
`data/version.json` with what it stored and reloads the dataset when it changed. Their boards are kept. A recipe that no
longer exists shows as a "Missing recipe" node.

## Sharing a board with a friend
Boards live in each person's browser. Use **Export board** and send the `.json` file; your friend uses **Import board**.
