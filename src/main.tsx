import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { Landing } from "./landing/Landing.tsx";
import "./styles.css";

// "/" is the landing page; the product lives at "/app".
const isApp = window.location.pathname.startsWith("/app");
document.title = isApp ? "Bites the Data" : "Bites the Data: Track Changes for AI agents' data";
createRoot(document.getElementById("root")!).render(isApp ? <App /> : <Landing />);
