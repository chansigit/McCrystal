using Client.MirGraphics;
using Client.MirNetwork;
using Client.MirScenes;
using Microsoft.Xna.Framework.Graphics;
using S = ServerPackets;

namespace Client.MirControls
{
    public abstract class MirScene : MirControl
    {
        public static MirScene ActiveScene = new LoginScene();

        private static MouseButtons _buttons;
        private static long _lastClickTime;
        private static MirControl _clickedControl;

        protected MirScene()
        {
            DrawControlTexture = false;
            BackColour = Color.Black;
            Size = new Size(Settings.ScreenWidth, Settings.ScreenHeight);
        }

        public override sealed Size Size
        {
            get { return base.Size; }
            set { base.Size = value; }
        }

        public override void Draw()
        {
            if (IsDisposed || !Visible)
                return;

            OnBeforeShown();

            // Draw scene-specific content (e.g. GameScene draws map here)
            DrawControl();

            // Draw UI children directly to back buffer (no intermediate render target)
            DrawChildControls();

            if (CMain.DebugBaseLabel != null && !CMain.DebugBaseLabel.IsDisposed)
                CMain.DebugBaseLabel.Draw();

            if (CMain.HintBaseLabel != null && !CMain.HintBaseLabel.IsDisposed)
                CMain.HintBaseLabel.Draw();

            OnShown();
        }

        protected override void CreateTexture()
        {
            if (Size != TextureSize)
                DisposeTexture();

            if (ControlTexture == null || ControlTexture.IsDisposed)
            {
                DXManager.ControlList.Add(this);
                ControlTexture = new RenderTarget2D(DXManager.Device, Size.Width, Size.Height, false,
                    SurfaceFormat.Color, DepthFormat.None, 0, RenderTargetUsage.PreserveContents);
                TextureSize = Size;
            }

            var oldSurface = DXManager.CurrentSurface;
            DXManager.SetSurface((RenderTarget2D)ControlTexture);

            DXManager.Device.Clear(BackColour);

            BeforeDrawControl();
            DrawChildControls();
            AfterDrawControl();

            DXManager.EndSpriteBatch();

            DXManager.SetSurface(oldSurface);
            TextureValid = true;
        }

        /// <summary>
        /// Walk the control tree to find the deepest visible control at the given point.
        /// This is used as a fallback when Highlight() was blocked by the ActiveControl guard.
        /// </summary>
        private static MirControl FindControlAtPoint(MirControl parent, Point p)
        {
            if (parent.Controls != null)
            {
                for (int i = parent.Controls.Count - 1; i >= 0; i--)
                {
                    var child = parent.Controls[i];
                    if (child.IsMouseOver(p))
                    {
                        var deeper = FindControlAtPoint(child, p);
                        return deeper ?? child;
                    }
                }
            }
            return null;
        }

        public override void OnMouseDown(MouseEventArgs e)
        {
            if (!Enabled)
                return;

            if (MouseControl != null && MouseControl != this)
            {
                MouseControl.OnMouseDown(e);
            }
            else
            {
                // MouseControl wasn't set (Highlight guard blocked it).
                // Find the actual control under the mouse and dispatch to it.
                var target = FindControlAtPoint(this, CMain.MPoint);
                if (target != null && target != this)
                    target.OnMouseDown(e);
                else
                    base.OnMouseDown(e);
            }
        }
        public override void OnMouseUp(MouseEventArgs e)
        {
            if (!Enabled)
                return;
            if (MouseControl != null && MouseControl != this)
                MouseControl.OnMouseUp(e);
            else
            {
                var target = FindControlAtPoint(this, CMain.MPoint);
                if (target != null && target != this)
                    target.OnMouseUp(e);
                else
                    base.OnMouseUp(e);
            }
        }
        public override void OnMouseMove(MouseEventArgs e)
        {
            if (!Enabled)
                return;

            if (MouseControl != null && MouseControl != this && MouseControl.Moving)
                MouseControl.OnMouseMove(e);
            else
                base.OnMouseMove(e);
        }
        public override void OnMouseWheel(MouseEventArgs e)
        {
            if (!Enabled)
                return;

            if (MouseControl != null && MouseControl != this)
                MouseControl.OnMouseWheel(e);
            else
                base.OnMouseWheel(e);
        }

        public override void OnMouseClick(MouseEventArgs e)
        {
            if (!Enabled)
                return;
            if (_buttons == e.Button)
            {
                if (_lastClickTime + SystemInformation.DoubleClickTime >= CMain.Time)
                {
                    OnMouseDoubleClick(e);
                    return;
                }
            }
            else
                _lastClickTime = 0;

            if (ActiveControl != null && ActiveControl.IsMouseOver(CMain.MPoint) && ActiveControl != this)
            {
                ActiveControl.OnMouseClick(e);
            }
            else
            {
                // ActiveControl wasn't set properly or mouse is outside it.
                // Find the actual control under the mouse and dispatch to it.
                var target = FindControlAtPoint(this, CMain.MPoint);
                if (target != null && target != this)
                    target.OnMouseClick(e);
                else
                    base.OnMouseClick(e);
            }

            _clickedControl = ActiveControl;

            _lastClickTime = CMain.Time;
            _buttons = e.Button;
        }

        public override void OnMouseDoubleClick(MouseEventArgs e)
        {
            if (!Enabled)
                return;
            _lastClickTime = 0;
            _buttons = MouseButtons.None;

            if (ActiveControl != null && ActiveControl.IsMouseOver(CMain.MPoint) && ActiveControl != this)
            {
                if (ActiveControl == _clickedControl)
                    ActiveControl.OnMouseDoubleClick(e);
                else
                    ActiveControl.OnMouseClick(e);
            }
            else
            {
                if (ActiveControl == _clickedControl)
                    base.OnMouseDoubleClick(e);
                else
                    base.OnMouseClick(e);
            }
        }

        public override void Redraw()
        {
            TextureValid = false;
        }

        public virtual void ProcessPacket(Packet p)
        {
            switch (p.Index)
            {
                case (short)ServerPacketIds.Disconnect: // Disconnected
                    Disconnect((S.Disconnect) p);
                    Network.Disconnect();
                    break;
                case (short)ServerPacketIds.NewItemInfo:
                    NewItemInfo((S.NewItemInfo) p);
                    break;
                case (short)ServerPacketIds.NewMonsterInfo:
                    NewMonsterInfo((S.NewMonsterInfo)p);
                    break;
                case (short)ServerPacketIds.NewNPCInfo:
                    NewNPCInfo((S.NewNPCInfo)p);
                    break;
                case (short)ServerPacketIds.NewChatItem:
                    NewChatItem((S.NewChatItem)p);
                    break;
                case (short)ServerPacketIds.NewQuestInfo:
                    NewQuestInfo((S.NewQuestInfo)p);
                    break;
                case (short)ServerPacketIds.NewRecipeInfo:
                    NewRecipeInfo((S.NewRecipeInfo)p);
                    break;
                case (short)ServerPacketIds.NewHeroInfo:
                    NewHeroInfo((S.NewHeroInfo)p);
                    break;
            }
        }

        private void NewItemInfo(S.NewItemInfo info)
        {
            GameScene.ItemInfoList.Add(info.Info);
            GameScene.OnItemInfoReceived(info.Info.Index);
        }

        private void NewMonsterInfo(S.NewMonsterInfo info)
        {
            GameScene.MonsterInfoList.RemoveAll(x => x.Index == info.Info.Index);
            GameScene.MonsterInfoList.Add(info.Info);
            GameScene.OnMonsterInfoReceived(info.Info.Index);
        }

        private void NewNPCInfo(S.NewNPCInfo info)
        {
            GameScene.NPCInfoList.RemoveAll(x => x.Index == info.Info.Index);
            GameScene.NPCInfoList.Add(info.Info);
            GameScene.OnNPCInfoReceived(info.Info.Index);
        }

        private void NewHeroInfo(S.NewHeroInfo info)
        {
            AddHeroInformation(info.Info, info.StorageIndex);
        }

        public void AddHeroInformation(ClientHeroInformation info, int storageIndex = -1)
        {
            if (info == null) return;
            GameScene.HeroInfoList.RemoveAll(x => x.Index == info.Index);
            GameScene.HeroInfoList.Add(info);

            if (storageIndex < 0) return;
            GameScene.HeroStorage[storageIndex] = info;
        }

        private void NewChatItem(S.NewChatItem p)
        {
            if (GameScene.ChatItemList.Any(x => x.UniqueID == p.Item.UniqueID)) return;

            GameScene.Bind(p.Item);
            GameScene.ChatItemList.Add(p.Item);
        }

        private void NewQuestInfo(S.NewQuestInfo info)
        {
            GameScene.QuestInfoList.Add(info.Info);
        }

        private void NewRecipeInfo(S.NewRecipeInfo info)
        {
            GameScene.RecipeInfoList.Add(info.Info);

            GameScene.Bind(info.Info.Item);

            for (int j = 0; j < info.Info.Tools.Count; j++)
                GameScene.Bind(info.Info.Tools[j]);

            for (int j = 0; j < info.Info.Ingredients.Count; j++)
                GameScene.Bind(info.Info.Ingredients[j]);
        }

        private static void Disconnect(S.Disconnect p)
        {
            switch (p.Reason)
            {
                case 0:
                    MirMessageBox.Show(GameLanguage.ClientTextMap.GetLocalization(ClientTextKeys.ShuttingDown), true);
                    break;
                case 1:
                    MirMessageBox.Show(GameLanguage.ClientTextMap.GetLocalization(ClientTextKeys.DisconnectedAnotherUserLogged), true);
                    break;
                case 2:
                    MirMessageBox.Show(GameLanguage.ClientTextMap.GetLocalization(ClientTextKeys.DisconnectedPacketError), true);
                    break;
                case 3:
                    MirMessageBox.Show(GameLanguage.ClientTextMap.GetLocalization(ClientTextKeys.DisconnectedServerCrashed), true);
                    break;
                case 4:
                    MirMessageBox.Show(GameLanguage.ClientTextMap.GetLocalization(ClientTextKeys.DisconnectedKickedByAdmin), true);
                    break;
                case 5:
                    MirMessageBox.Show(GameLanguage.ClientTextMap.GetLocalization(ClientTextKeys.DisconnectedMaxConnectionsReached), true);
                    break;
            }

            GameScene.LogTime = 0;
        }

        public abstract void Process();

        #region Disposable

        protected override void Dispose(bool disposing)
        {

            base.Dispose(disposing);

            if (!disposing) return;

            if (ActiveScene == this) ActiveScene = null;

            _buttons = 0;
            _lastClickTime = 0;
            _clickedControl = null;
        }

        #endregion
    }
}
