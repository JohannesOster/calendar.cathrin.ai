import { createSignal } from "solid-js";
import { Search } from "lucide-solid";
import { SIDEBAR } from "../../constants/sidebar";

export function SearchInput() {
  const [searchQuery, setSearchQuery] = createSignal("");

  return (
    <div class="p-3 border-b border-border">
      <div class="relative">
        <Search
          size={SIDEBAR.ICON_LG}
          class="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted"
        />
        <input
          type="text"
          placeholder="Search events"
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
          class="w-full pl-8 pr-3 py-1.5 text-sm bg-surface-input rounded-md border-none outline-none placeholder:text-fg-muted text-fg focus:ring-2 focus:ring-accent focus:ring-opacity-50"
        />
      </div>
    </div>
  );
}
