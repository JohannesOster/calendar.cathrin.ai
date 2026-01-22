import "./App.css";

function App() {
  return (
    <div class="h-screen flex flex-col">
      {/* Drag region for window dragging on macOS */}
      <div
        data-tauri-drag-region
        class="h-8 w-full shrink-0 select-none bg-blue-200"
      />
      <div class="flex-1">
        Calendar
      </div>
    </div>
  );
}

export default App;
