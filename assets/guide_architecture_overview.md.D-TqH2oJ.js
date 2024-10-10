import{_ as t,c as o,a4 as a,o as i}from"./chunks/framework.HRJQlUB0.js";const s="/becsy/assets/architecture.B2jSCNT2.svg",n="/becsy/assets/dragons.4tvBUDxe.svg",f=JSON.parse('{"title":"Overview","description":"","frontmatter":{"sidebarDepth":2},"headers":[],"relativePath":"guide/architecture/overview.md","filePath":"guide/architecture/overview.md","lastUpdated":1728544170000}'),l={name:"guide/architecture/overview.md"};function c(d,e,r,h,m,p){return i(),o("div",null,e[0]||(e[0]=[a('<p><img src="'+s+'" alt="ECS architecture"></p><h1 id="overview" tabindex="-1">Overview <a class="header-anchor" href="#overview" aria-label="Permalink to &quot;Overview&quot;">​</a></h1><p>ECS (Entity Component System) is an architectural pattern where computation is defined as a list of systems operating on a set of entities, each of which consists of a dynamic set of pure data components. Systems select the entities to process via means of persistent, efficient queries over the entities&#39; component &quot;shapes&quot;.</p><p>Here&#39;s a short glossary cribbed from the <a href="./../getting-started">getting started guide</a> (which you should probably read first):</p><ul><li><a href="./entities">entities</a>: an object with a unique ID that can have multiple components attached to it.</li><li><a href="./components">components</a>: different facets of an entity, e.g. geometry, physics, hit points. Data is only stored in components.</li><li><a href="./systems">systems</a>: pieces of code that do the actual work within an application by processing entities and modifying their components.</li><li><a href="./queries">queries</a>: used by systems to determine which entities they are interested in, based on the components attached to the entities.</li><li><a href="./world">world</a>: a container for entities, components, systems and queries.</li></ul><p>The usual workflow when building an ECS based program:</p><ol><li>Create the <em>component</em> types that shape the data you need to use in your application.</li><li>Create <em>entities</em> and attach <em>components</em> to them.</li><li>Create the <em>systems</em> that will use these <em>components</em> to read and transform the data of <em>entities</em> selected by a <em>query</em>.</li><li>Execute all the <em>systems</em> each frame.</li></ol><h2 id="example" tabindex="-1">Example <a class="header-anchor" href="#example" aria-label="Permalink to &quot;Example&quot;">​</a></h2><p>Let&#39;s say we want to create a game where the player fights with wolves and dragons. We will start by defining components that will be attached to entities:</p><ul><li><code>Walker</code> and <code>Flyer</code> for entities that will walk and fly (respectively).</li><li><code>Enemy</code> for enemy entities.</li><li><code>Model3D</code> for all the entities that will have a 3D Model.</li></ul><p>Then we use these components to define our main entities:</p><ul><li><code>wolf</code>: It&#39;s an <code>Enemy</code>, can <code>walk</code> and has a <code>model3D</code>.</li><li><code>dragon</code>: It&#39;s an <code>Enemy</code>, can <code>fly</code> and has a <code>model3D</code>.</li><li><code>player</code>: It&#39;s an <code>Player</code>, can <code>walk</code> and has a <code>model3D</code>.</li></ul><p>And finally we define the systems that will add the logic to the game:</p><ul><li><code>Walk</code>: It will modify the <code>Walker</code> entities (<code>Player</code> and <code>Wolf</code>) moving them around.</li><li><code>Fly</code>: It will modify the <code>Flyer</code> entities (<code>Dragon</code>) moving them around in the sky.</li><li><code>AI_Walk</code>: It will modify the <code>Enemy</code> and <code>Walker</code> entities (<code>Wolf</code>) using AI techniques to compute the path they will follow.</li><li><code>Attack</code>: It will implement all the logic for attacks between <code>Enemy</code> and <code>Player</code> entities.</li><li><code>Draw</code>: It will draw all the entities that has <code>Model3D</code> component on the screen.</li></ul><p><img src="'+n+'" alt="Wolves and dragons example"></p>',15)]))}const y=t(l,[["render",c]]);export{f as __pageData,y as default};