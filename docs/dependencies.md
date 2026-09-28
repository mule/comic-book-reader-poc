# Dependencies and licenses

Direct dependencies and build tools checked against upstream license files on 2026-09-28. Exact resolved package versions are in `tools/uv.lock` and `reader/pnpm-lock.yaml`; use locked installs. This list is a direct-dependency inventory, not a complete redistribution notice bundle for transitive/native components.

| Dependency | Use | License and primary source |
| --- | --- | --- |
| pypdfium2 | PDF inspection/rendering | Apache-2.0 OR BSD-3-Clause; [upstream licensing](https://github.com/pypdfium2-team/pypdfium2#licensing) |
| PDFium (bundled by pypdfium2) | Native PDF engine | BSD-style, plus third-party notices; [bundled license notices](https://github.com/pypdfium2-team/pypdfium2/blob/main/BUILD_LICENSES/pdfium.txt) |
| Pillow | Synthetic PDFs and thumbnails | MIT-CMU (historical PIL license); [LICENSE](https://github.com/python-pillow/Pillow/blob/main/LICENSE) |
| numpy | Representation difference metrics (PSNR, MSE) | BSD-3-Clause; [LICENSE](https://github.com/numpy/numpy/blob/main/LICENSE.txt) |
| pytest | Python tests | MIT; [LICENSE](https://github.com/pytest-dev/pytest/blob/main/LICENSE) |
| ruff | Python lint/format | MIT; [LICENSE](https://github.com/astral-sh/ruff/blob/main/LICENSE) |
| hatchling | Editable Python build | MIT; [LICENSE](https://github.com/pypa/hatch/blob/master/LICENSE.txt) |
| React, react-dom | Minimal reader UI | MIT; [LICENSE](https://github.com/facebook/react/blob/main/LICENSE) |
| @types/react, @types/react-dom | Type declarations | MIT; [DefinitelyTyped LICENSE](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/LICENSE) |
| TypeScript | Strict type checking | Apache-2.0; [LICENSE](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt) |
| Vite | Local server and production build | MIT; [LICENSE](https://github.com/vitejs/vite/blob/main/LICENSE) |
| Vitest | Reader unit tests | MIT; [LICENSE](https://github.com/vitest-dev/vitest/blob/main/LICENSE) |
| ESLint, @eslint/js | Reader lint | MIT; [LICENSE](https://github.com/eslint/eslint/blob/main/LICENSE) |
| typescript-eslint | TypeScript lint integration | MIT; [LICENSE](https://github.com/typescript-eslint/typescript-eslint/blob/main/LICENSE) |
| uv | Python dependency management | Apache-2.0 OR MIT; [MIT license](https://github.com/astral-sh/uv/blob/main/LICENSE-MIT) |
| pnpm | Reader dependency management | MIT; [LICENSE](https://github.com/pnpm/pnpm/blob/main/LICENSE) |
| jsonschema | Offline manifest and annotation validation | MIT; [upstream COPYING](https://github.com/python-jsonschema/jsonschema/blob/main/COPYING), checked 2026-09-28; resolved version and transitive packages locked in tools/uv.lock |
| ajv | Manifest validation against the canonical JSON schema in the browser | MIT; [LICENSE](https://github.com/ajv-validator/ajv/blob/master/LICENSE), checked 2026-09-28 |
| @testing-library/react, @testing-library/dom | Reader component tests | MIT; [LICENSE](https://github.com/testing-library/dom-testing-library/blob/main/LICENSE) |
| @testing-library/user-event, @testing-library/jest-dom | Reader test interaction and matchers | MIT; same project licenses |
| jsdom | Vitest browser environment for unit tests | MIT; [LICENSE](https://github.com/jsdom/jsdom/blob/main/README.md#license) |
| @types/node | Types for the Vite plugin and test tooling | MIT; [DefinitelyTyped LICENSE](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/main/LICENSE) |

Pillow and PDFium wheels bundle native libraries with their own license notices. Preserve the installed distribution notices if packaging these tools for redistribution. Purchased comics and generated previews remain subject to their original rights and are excluded from Git and CI.

## Detection baseline decision (2026-09-28)

- **Kumiko candidate:** examined primary upstream README and [LICENSE at commit `9d587ae9498bc84dfda06fc19c6ad89f421bec14`](https://github.com/njean42/kumiko/blob/9d587ae9498bc84dfda06fc19c6ad89f421bec14/LICENSE). The license grants AGPL-3.0-or-later. It is unsuitable for direct vendoring in this experiment: we do not want to incorporate copyleft detector source. No Kumiko code was copied, downloaded into the repository, or executed. This is a dependency/license suitability evaluation, **not a measured Kumiko accuracy comparison**. The allowed alternative is an independent, small OpenCV external-contour baseline, implemented from OpenCV primitives; it is not an algorithm-equivalent port of Kumiko's heuristics. There is no Kumiko runtime dependency or floating download.
- **opencv-python-headless 4.13.0.92**, exactly pinned in `tools/pyproject.toml` and hash-locked in `tools/uv.lock`: Python packaging is MIT ([upstream LICENSE](https://github.com/opencv/opencv-python/blob/master/LICENSE.txt)); OpenCV 4.13.0 is Apache-2.0 ([release LICENSE](https://github.com/opencv/opencv/blob/4.13.0/LICENSE)). Headless avoids adding a desktop GUI runtime. Native wheels include third-party components with additional notices; preserve their installed license bundle when redistributing. Existing locked NumPy supplies image arrays.
