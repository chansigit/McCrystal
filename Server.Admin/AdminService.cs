using Server.MirDatabase;
using Server.MirEnvir;

namespace Server.Admin
{
    /// <summary>Queries and actions over one <see cref="Envir"/>. Knows nothing about HTTP.</summary>
    public sealed partial class AdminService
    {
        private readonly Envir envir;
        private readonly AdminActionRunner runner;

        public AdminService(Envir envir, AdminActionRunner runner = null)
        {
            this.envir = envir;
            this.runner = runner ?? new AdminActionRunner(envir);
        }

        // ---------- helpers ----------

        private static bool Matches(string value, string query)
        {
            if (string.IsNullOrEmpty(query)) return true;
            return value != null && value.Contains(query, StringComparison.OrdinalIgnoreCase);
        }

        private static string MapName(MapInfo info)
        {
            if (info == null) return string.Empty;
            return string.IsNullOrEmpty(info.Title) ? info.FileName : info.Title;
        }

        private static List<ItemRowModel> ItemRows(UserItem[] items)
        {
            var rows = new List<ItemRowModel>();
            if (items == null) return rows;
            for (int i = 0; i < items.Length; i++)
            {
                var item = items[i];
                if (item == null) continue;
                rows.Add(new ItemRowModel
                {
                    Slot = i,
                    Name = item.Info == null ? $"#{item.ItemIndex}" : item.Info.Name,
                    Count = item.Count,
                    CurrentDura = item.CurrentDura,
                    MaxDura = item.MaxDura
                });
            }
            return rows;
        }
    }
}
