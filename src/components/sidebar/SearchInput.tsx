import { createSignal } from "solid-js";
import { Search } from "lucide-solid";
import { SIDEBAR } from "../../constants/sidebar";

export function SearchInput() {
  const [searchQuery, setSearchQuery] = createSignal("");

  return (
    <div class="p-3 border-b border-[#e8e8e8]">
      <div class="relative">
        <Search
          size={SIDEBAR.ICON_LG}
          class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#91918e]"
        />
        <input
          type="text"
          placeholder="Search events"
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
          class="w-full pl-8 pr-3 py-1.5 text-sm bg-[#f1f1ef] rounded-md border-none outline-none placeholder:text-[#91918e] text-[#37352f] focus:ring-2 focus:ring-[#2383e2] focus:ring-opacity-50"
        />
      </div>
    </div>
  );
}
