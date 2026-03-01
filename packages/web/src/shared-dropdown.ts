export interface DropdownOption {
  value: string;
  label: string;
}

export class SharedDropdown {
  private panel: HTMLElement;
  private options: DropdownOption[];
  private currentTrigger: HTMLElement | null = null;
  private currentCallback: ((value: string) => void) | null = null;
  private activeIndex = 0;

  constructor(fieldType: string, options: DropdownOption[]) {
    this.options = options;
    this.panel = document.createElement("div");
    this.panel.className = "shared-dropdown-panel";
    this.panel.dataset.fieldType = fieldType;
    this.panel.setAttribute("role", "listbox");
    // Delegation: single click handler on panel, reads data-value
    this.panel.addEventListener("click", this.handlePanelClick);
    document.body.appendChild(this.panel);
    document.addEventListener("click", this.handleClickOutside);
  }

  open(
    trigger: HTMLElement,
    currentValue: string,
    onSelect: (value: string) => void,
  ): void {
    this.currentTrigger = trigger;
    this.currentCallback = onSelect;
    this.activeIndex = Math.max(
      0,
      this.options.findIndex((o) => o.value === currentValue),
    );
    this.panel.innerHTML = "";
    for (const [idx, opt] of this.options.entries()) {
      const item = document.createElement("div");
      item.className =
        "shared-dropdown-item" + (idx === this.activeIndex ? " active" : "");
      item.textContent = opt.label;
      item.dataset.value = opt.value;
      item.setAttribute("role", "option");
      this.panel.appendChild(item);
    }
    // Viewport-aware positioning: flip above trigger if insufficient space below
    const rect = trigger.getBoundingClientRect();
    const maxPanelHeight = 300; // matches CSS max-height
    const spaceBelow = window.innerHeight - rect.bottom - 4;
    const flipAbove = spaceBelow < maxPanelHeight && rect.top > spaceBelow;
    this.panel.style.position = "fixed";
    this.panel.style.left = `${rect.left}px`;
    this.panel.style.minWidth = `${rect.width}px`;
    if (flipAbove) {
      this.panel.style.top = "";
      this.panel.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    } else {
      this.panel.style.bottom = "";
      this.panel.style.top = `${rect.bottom + 4}px`;
    }
    this.panel.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    // Register keyboard and scroll listeners only while open
    document.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("scroll", this.handleScroll, true);
  }

  close(): void {
    this.panel.classList.remove("open");
    this.panel.innerHTML = "";
    this.currentTrigger?.setAttribute("aria-expanded", "false");
    this.currentTrigger?.focus();
    this.currentTrigger = null;
    this.currentCallback = null;
    // Remove listeners that are only needed while open
    document.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("scroll", this.handleScroll, true);
  }

  private select(value: string): void {
    const cb = this.currentCallback;
    this.close();
    cb?.(value);
  }

  private handlePanelClick = (e: MouseEvent): void => {
    const item = (e.target as Element).closest(".shared-dropdown-item") as HTMLElement | null;
    if (item?.dataset.value != null) {
      e.stopPropagation(); // prevent click-outside from also firing
      this.select(item.dataset.value);
    }
  };

  // Registered on document only while the panel is open (in open/close)
  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      this.close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      this.activeIndex = (this.activeIndex + 1) % this.options.length;
      this.updateActive();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.activeIndex =
        (this.activeIndex - 1 + this.options.length) % this.options.length;
      this.updateActive();
    } else if (e.key === "Enter") {
      e.preventDefault();
      this.select(this.options[this.activeIndex].value);
    }
  };

  private handleScroll = (): void => {
    this.close();
  };

  private updateActive(): void {
    this.panel
      .querySelectorAll(".shared-dropdown-item")
      .forEach((item, idx) => {
        item.classList.toggle("active", idx === this.activeIndex);
        if (idx === this.activeIndex) {
          (item as HTMLElement).scrollIntoView?.({ block: "nearest" });
        }
      });
  }

  private handleClickOutside = (e: MouseEvent): void => {
    if (!this.panel.classList.contains("open")) return;
    if (
      !this.panel.contains(e.target as Node) &&
      !this.currentTrigger?.contains(e.target as Node)
    ) {
      this.close();
    }
  };

  destroy(): void {
    // Close first to clean up keyboard/scroll listeners if open
    if (this.panel.classList.contains("open")) this.close();
    this.panel.removeEventListener("click", this.handlePanelClick);
    document.removeEventListener("click", this.handleClickOutside);
    this.panel.remove();
  }
}
