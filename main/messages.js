// Messages this session exchanged with other sessions (SendMessage), see messages() in server/transcript.py.
module.exports = ({ ipcMain, transcript }) => {
  ipcMain.handle('messages:list', async (_e, id) => JSON.parse((await transcript(id, 'messages')) || '[]'));
};
