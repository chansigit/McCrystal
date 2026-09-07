namespace Crystal.Web;

public static class ShopPrices
{
    public static object Project(ServerPackets.NPCGoods goods, IReadOnlyDictionary<int, ItemInfo> definitions)
    {
        var prices = new Dictionary<string, uint>();
        foreach (var item in goods.List)
        {
            if (!definitions.TryGetValue(item.ItemIndex, out var info)) continue;
            var single = new UserItem(info)
            {
                Count = 1, MaxDura = item.MaxDura, CurrentDura = item.CurrentDura,
                AddedStats = item.AddedStats
            };
            prices[item.UniqueID.ToString()] = single.Price();
        }
        return new Goods
        {
            List = goods.List, Rate = goods.Rate, Type = goods.Type,
            HideAddedStats = goods.HideAddedStats, BasePrices = prices
        };
    }

    public sealed class Goods
    {
        public List<UserItem> List = new();
        public float Rate;
        public PanelType Type;
        public bool HideAddedStats;
        public Dictionary<string, uint> BasePrices = new();
    }
}
