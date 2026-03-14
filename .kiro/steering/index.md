---
inclusion: always
---

# Obsidian Plugin Documentation Index

Reference index for all Obsidian plugin development documentation pages.
Use `#` in chat to include any of these steering files for detailed guidance.

## Editor

- **Communicating with editor extensions** (`Editor - Communicating with editor extensions.md`): Once you've built your editor extension, you might want to communicate with it from outside the editor. For example, through a [[Commands|command]], o
- **Decorations** (`Editor - Decorations.md`): Decorations let you control how to draw or style content in [[Editor extensions|editor extensions]]. If you intend to change the look and feel by addi
- **Editor extensions** (`Editor - Editor extensions.md`): Editor extensions let you customize the experience of editing notes in Obsidian. This page explains what editor extensions are, and when to use them.
- **Editor** (`Editor - Editor.md`): The [[Reference/TypeScript API/Editor|Editor]] class exposes operations for reading and manipulating an active Markdown document in edit mode.
- **Markdown post processing** (`Editor - Markdown post processing.md`): If you want to change how a Markdown document is rendered in Reading view, you can add your own _Markdown post processor_. As indicated by the name, t
- **State fields** (`Editor - State fields.md`): A state field is an [[Editor extensions|editor extension]] that lets you manage custom editor state. This page walks you through building a state fiel
- **State management** (`Editor - State management.md`): This page aims to give an introduction to state management for [[Editor extensions|editor extensions]].
- **View plugins** (`Editor - View plugins.md`): A view plugin is an [[Editor extensions|editor extension]] that gives you access to the editor [[Viewport]].
- **Viewport** (`Editor - Viewport.md`): The Obsidian editor supports [huge documents](https://codemirror.net/examples/million/) with millions of lines. One of the reasons why this is possibl

## Core

- **Events** (`Events.md`): Many of the interfaces in the Obsidian lets you subscribe to events throughout the application, for example when the user makes changes to a file.
- **Vault** (`Vault.md`): Each collection of notes in Obsidian is known as a Vault. A Vault consists of a folder, and any sub-folders within it.

## Getting started

- **Anatomy of a plugin** (`Getting started - Anatomy of a plugin.md`): The [[Plugin|Plugin]] class defines the lifecycle of a plugin and exposes the operations available to all plugins:
- **Build a plugin** (`Getting started - Build a plugin.md`): Plugins let you extend Obsidian with your own features to create a custom note-taking experience.
- **Development workflow** (`Getting started - Development workflow.md`): Whenever you make a change to the plugin source code, the plugin needs to be reloaded. You can reload the plugin by quitting Obsidian and starting it 
- **Mobile development** (`Getting started - Mobile development.md`): Learn how you can develop your plugin for mobile devices.
- **Use React in your plugin** (`Getting started - Use React in your plugin.md`): In this guide, you'll configure your plugin to use [React](https://react.dev/). It assumes that you already have a plugin with a [[Views|custom view]]
- **Use Svelte in your plugin** (`Getting started - Use Svelte in your plugin.md`): This guide explains how to configure your plugin to use [Svelte](https://svelte.dev/), a light-weight alternative to traditional frameworks like React

## Guides

- **Build a Bases view** (`Guides - Build a Bases view.md`): Bases is a core plugin in Obsidian which display dynamic views of your notes as tables, cards, lists, and more. If you're unfamiliar with Bases, pleas
- **Defer views** (`Guides - Defer views.md`): As of Obsidian v1.7.2, When Obsidian loads, all views are created as instances of **DeferredView**. Once a view is visible on screen (i.e. the tab is 
- **Optimize plugin load time** (`Guides - Optimize plugin load time.md`): Plugins play an important role in app load time. To ensure that Obsidian behaves correctly, Obsidian loads all plugins before the user can interact wi
- **Store secrets** (`Guides - Store secrets.md`): [[SecretStorage]] provides a secure way to store and manage sensitive data like API keys and tokens in Obsidian plugins. Instead of storing secrets di
- **Support pop-out windows** (`Guides - Support pop-out windows.md`): With the release of [Obsidian v0.15.0](https://obsidian.md/changelog/2022-06-14-desktop-v0.15.0/), the pop-out windows feature was added to the deskto

## Releasing

- **Beta-testing plugins** (`Releasing - Beta-testing plugins.md`): Before you [[Submit your plugin|submit your plugin]], you may want to let users try it out first. While Obsidian doesn't officially support beta relea
- **Plugin guidelines** (`Releasing - Plugin guidelines.md`): This page lists common review comments plugin authors get when submitting their plugin.
- **Release your plugin with GitHub Actions** (`Releasing - Release your plugin with GitHub Actions.md`): Manually releasing your plugin can be time-consuming and error-prone. In this guide, you'll configure your plugin to use [GitHub Actions](https://gith
- **Submission requirements for plugins** (`Releasing - Submission requirements for plugins.md`): This page lists extends the [[Developer policies]] with plugin-specific requirements that all plugins must follow to be published.
- **Submit your plugin** (`Releasing - Submit your plugin.md`): If you want to share your plugin with the Obsidian community, the best way is to submit it to the [official list of plugins](https://github.com/obsidi

## User interface

- **About user interface** (`User interface - About user interface.md`): This page gives you an overview of how to add or change the Obsidian user interface.
- **Commands** (`User interface - Commands.md`): Commands are actions that the user can invoke from the [Command Palette](https://help.obsidian.md/Plugins/Command+palette) or by using a hot key.
- **Context menus** (`User interface - Context menus.md`): If you want to open up a context menu, use [[Menu|Menu]]:
- **HTML elements** (`User interface - HTML elements.md`): Several components in the Obsidian API, such as the [[Settings]], expose _container elements_:
- **Icons** (`User interface - Icons.md`): Several of the UI components in the Obsidian API let you configure an accompanying icon. You can choose from one of the built-in icons, or you can add
- **Modals** (`User interface - Modals.md`): Modals display information and accept user input. To create a modal, create a class that extends [[Reference/TypeScript API/Modal|Modal]]:
- **Ribbon actions** (`User interface - Ribbon actions.md`): The sidebar on the left side of the Obsidian interface is mainly known as the _ribbon_. The purpose of the ribbon is to host actions defined by plugin
- **Right-to-left** (`User interface - Right-to-left.md`): Obsidian supports right-to-left (RTL) languages such as Arabic, Dhivehi, Hebrew, Farsi, Syriac, and Urdu. These languages are spoken by more than 600 
- **Settings** (`User interface - Settings.md`): If you want users to be able to configure parts of your plugin themselves, you can expose them as _settings_.
- **Status bar** (`User interface - Status bar.md`): To create a new block in the status bar, call the [[addStatusBarItem|addStatusBarItem()]] in the `onload()` method. The `addStatusBarItem()` method re
- **Views** (`User interface - Views.md`): Views determine how Obsidian displays content. The file explorer, graph view, and the Markdown view are all examples of views, but you can also create
- **Workspace** (`User interface - Workspace.md`): Obsidian lets you configure what content is visible to you at any given time. Hide the file explorer when you don't need it, display multiple document

