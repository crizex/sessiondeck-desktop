// Recap: short account of a session (duration, commits, files, what is not committed), see recap() in server/transcript.py.
module.exports = ({ ipcMain, transcript }) => {
  ipcMain.handle('recap:load', async (_e, id) => JSON.parse(await transcript(id, 'recap')));
};
