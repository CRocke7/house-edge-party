# House Edge — Party Table

An online multiplayer party game for 2–8 friends. It uses fictional chips only: no real-money betting, purchases, or cash-outs.

## Run it on your laptop

Requires Node.js 18 or newer.

1. Unzip the project.
2. Open Terminal in the project folder.
3. Run `npm install`
4. Run `npm start`
5. Open `http://localhost:3000`

This lets you test on your own computer. To play online with friends on separate networks, the server must be deployed to a public Node.js host (for example, Render, Railway, or another Node-compatible host). Upload the whole project folder and use the host's assigned public URL. The host must support persistent WebSocket connections for Socket.IO.

## Play

- Create a room and send the five-character room code to friends.
- 2–8 players; the host starts the game.
- Everyone begins with 1,000 fictional chips.
- Each round, stake at least 10 chips (or sit out).
- Choose **Steady** or **Bold**. Bold adds +2 to your dice score.
- Two dice are rolled server-side. Highest score wins the pot; ties split it.
- The player with the biggest stack after 3, 5, or 10 rounds wins.

## Files

- `index.html` — game UI and client logic
- `server.js` — room management and server-side game logic
- `package.json` — dependencies and start script

## Notes

This is a playable starter project, not a hosted service. The game files do not create a public internet address by themselves. You or a hosting provider must run `npm start` on a public Node.js host before friends in different locations can connect. Room state is kept in server memory, so rooms reset if the server restarts.
