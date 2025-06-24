# Pin Calendar

A calendar-based activity tracking web app with multi-client synchronization.

## Running on Windows:
```ps1
fnm env --use-on-cd | Out-String | Invoke-Expression && fnm use 22
npm run dev
```

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## TODO

* Change Pin/PinCategory ID to a UUID
* Make Pins cloneable
* Make it possible to move Pins/PinCategories
* Make the website accessible offline using a Service Worker:
    https://microsoft.github.io/win-student-devs/#/30DaysOfPWA/core-concepts/05
    https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
