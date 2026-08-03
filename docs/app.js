(() => {
  const copyButtons = document.querySelectorAll("[data-copy]");
  const releaseStatusNodes = document.querySelectorAll("[data-release-status]");
  const versionNodes = document.querySelectorAll("[data-release-version]");
  const licenseNodes = document.querySelectorAll("[data-release-license]");
  const engineNodes = document.querySelectorAll("[data-release-engine]");
  const binNodes = document.querySelectorAll("[data-release-bin]");
  const packageScopeNodes = document.querySelectorAll("[data-release-package-scope]");
  const packageNameNodes = document.querySelectorAll("[data-release-package]");
  const pagesStatusNodes = document.querySelectorAll("[data-pages-status]");
  const commitNodes = document.querySelectorAll("[data-release-commit]");
  const packageNote = document.querySelector("[data-package-note]");
  const publishedPathLabel = document.querySelector("[data-published-path-label]");
  const publishedPathStatus = document.querySelector("[data-published-path-status]");
  const publishedPathMessage = document.querySelector("[data-published-path-message]");
  const publishedPathCard = document.querySelector("[data-published-path-card]");
  const registryMessage = document.querySelector("[data-registry-message]");
  const installSummary = document.querySelector("[data-install-summary]");
  const publicationMessage = document.querySelector("[data-publication-message]");

  const setButtonState = (button, text, delay = 1500) => {
    const original = button.dataset.originalLabel || button.textContent;
    button.dataset.originalLabel = original;
    button.textContent = text;
    window.setTimeout(() => {
      button.textContent = original;
    }, delay);
  };

  const copyText = async (value) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    if (!copied) throw new Error("Clipboard unavailable");
  };

  for (const button of copyButtons) {
    button.addEventListener("click", async () => {
      const value = button.getAttribute("data-copy");
      if (!value) return;

      try {
        await copyText(value);
        setButtonState(button, "copied");
      } catch {
        setButtonState(button, "select manually", 2200);
      }
    });
  }

  const updateReleaseMetadata = (release) => {
    if (!release || typeof release !== "object") return;

    if (release.publicationStatus) {
      for (const node of releaseStatusNodes) {
        node.textContent = release.publicationStatus;
      }

      const isPublished = release.publicationStatus === "PUBLISHED";
      for (const node of document.querySelectorAll(".status-dot")) {
        node.classList.toggle("status-dot-warning", !isPublished);
        node.classList.toggle("status-dot-published", isPublished);
      }
      for (const node of document.querySelectorAll(".status-label")) {
        if (node.querySelector("[data-release-status]")) {
          node.classList.toggle("status-label-warning", !isPublished);
          node.classList.toggle("status-label-published", isPublished);
        }
      }

      if (isPublished) {
        if (packageNote) packageNote.textContent = "The exact npm package and tarball match this release. Use the published path below.";
        if (publishedPathLabel) publishedPathLabel.textContent = "PUBLISHED PATH / PRIMARY INSTALL";
        if (publishedPathStatus) {
          publishedPathStatus.textContent = "AVAILABLE";
          publishedPathStatus.classList.remove("status-label-muted");
          publishedPathStatus.classList.add("status-label-published");
        }
        if (publishedPathMessage) publishedPathMessage.textContent = "The package path is available after the registry check returned this version.";
        if (publishedPathCard) publishedPathCard.classList.add("code-card-published");
        if (registryMessage) registryMessage.textContent = "The exact version and tarball are available from npm.";
        if (installSummary) installSummary.textContent = "The published package path is verified. The source path remains available for contributors and reproducible checks.";
        if (publicationMessage) publicationMessage.textContent = "npm publication verified for this version and tarball";
      }
    }

    if (release.version) {
      for (const node of versionNodes) {
        node.textContent = release.version;
      }
    }

    if (release.license) {
      for (const node of licenseNodes) {
        node.textContent = release.license;
      }
    }

    if (release.engine) {
      const engine = release.engine.replace(/^>=/, "≥");
      for (const node of engineNodes) {
        node.textContent = engine;
      }
    }

    if (release.bin) {
      for (const node of binNodes) {
        node.textContent = release.bin;
      }
    }

    if (release.name) {
      const separator = release.name.lastIndexOf("/");
      const scope = separator >= 0 ? release.name.slice(0, separator + 1) : "";
      const packageName = separator >= 0 ? release.name.slice(separator + 1) : release.name;
      for (const node of packageScopeNodes) {
        node.textContent = scope;
      }
      for (const node of packageNameNodes) {
        node.textContent = packageName;
      }
    }

    if (release.deploymentStatus) {
      for (const node of pagesStatusNodes) {
        node.textContent = release.deploymentStatus;
      }
    }

    if (release.commit) {
      for (const node of commitNodes) {
        node.textContent = release.commit;
      }
    }

    document.documentElement.dataset.publicationStatus = release.publicationStatus || "";
  };

  fetch("./release.json", { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("release metadata unavailable");
      return response.json();
    })
    .then(updateReleaseMetadata)
    .catch(() => {
      document.documentElement.dataset.publicationStatus = "NOT-PUBLISHED";
    });
})();
