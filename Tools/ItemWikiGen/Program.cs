class Program
{
    static void Main(string[] args)
    {
        string repoRoot = FindRepoRoot();

        string dbPath = Path.Combine(repoRoot, "Build", "Server", "Debug", "Server.MirDB");
        string libPath = Path.Combine(repoRoot, "Build", "Client", "Debug", "Data", "Items.Lib");
        string outputPath = Path.Combine(repoRoot, "Build", "Server", "Debug", "ItemWiki.html");

        if (args.Length >= 1) dbPath = args[0];
        if (args.Length >= 2) libPath = args[1];
        if (args.Length >= 3) outputPath = args[2];

        Console.WriteLine($"Database:  {dbPath}");
        Console.WriteLine($"Items.Lib: {libPath}");
        Console.WriteLine($"Output:    {outputPath}");
        Console.WriteLine();

        if (!File.Exists(dbPath))
        {
            Console.WriteLine("ERROR: Database file not found!");
            return;
        }
        if (!File.Exists(libPath))
        {
            Console.WriteLine("ERROR: Items.Lib file not found!");
            return;
        }

        Console.WriteLine("Reading database...");
        var items = DbReader.ReadItemInfoList(dbPath);
        Console.WriteLine($"  Loaded {items.Count} items.");

        Console.WriteLine("Reading Items.Lib...");
        using var libReader = new LibReader(libPath);
        Console.WriteLine($"  Library contains {libReader.Count} images.");

        Console.WriteLine("Extracting icons...");
        var iconCache = new Dictionary<int, string>();
        int extracted = 0, failed = 0;
        foreach (var item in items)
        {
            int imageIndex = item.Image;
            if (iconCache.ContainsKey(imageIndex))
                continue;

            var base64 = libReader.GetBase64Png(imageIndex);
            if (base64 != null)
            {
                iconCache[imageIndex] = base64;
                extracted++;
            }
            else
            {
                failed++;
            }
        }
        Console.WriteLine($"  Extracted {extracted} unique icons ({failed} missing).");

        Console.WriteLine("Generating HTML...");
        string html = HtmlGenerator.Generate(items, iconCache);

        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
        File.WriteAllText(outputPath, html);

        var fileSize = new FileInfo(outputPath).Length;
        Console.WriteLine($"  Written: {outputPath}");
        Console.WriteLine($"  Size: {fileSize / 1024.0:F0} KB");
        Console.WriteLine("Done!");
    }

    static string FindRepoRoot()
    {
        string dir = Directory.GetCurrentDirectory();
        while (dir != null)
        {
            if (Directory.Exists(Path.Combine(dir, "Build")) &&
                Directory.Exists(Path.Combine(dir, "Shared")))
                return dir;
            dir = Path.GetDirectoryName(dir);
        }
        return Directory.GetCurrentDirectory();
    }
}
