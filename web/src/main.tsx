import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { App, HomeRoute, InboxRoute, NotFoundRoute } from "./App";
import "./styles.css";

const router = createBrowserRouter([
	{
		path: "/",
		Component: App,
		children: [
			{ index: true, Component: HomeRoute },
			{ path: "inbox/:address", Component: InboxRoute },
			{ path: "*", Component: NotFoundRoute },
		],
	},
]);

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<RouterProvider router={router} />
	</StrictMode>,
);
