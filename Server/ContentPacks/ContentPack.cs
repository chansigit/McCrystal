using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace Server.ContentPacks
{
    public sealed class ContentPackManifest
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Version { get; set; }
        public string Engine { get; set; }
        public int DatabaseSchema { get; set; }
        public string Locale { get; set; }
        public string ClientAssets { get; set; }
        public string ContentRoot { get; set; } = ".";
        public ContentPackPaths Paths { get; set; } = new ContentPackPaths();
    }

    public sealed class ContentPackPaths
    {
        public string Configs { get; set; } = "Configs";
        public string Envir { get; set; } = "Envir";
        public string Maps { get; set; } = "Maps";
        public string Database { get; set; } = "Server.MirDB";
    }

    public sealed class ContentPack
    {
        public const string PackEnvironmentVariable = "MCCRYSTAL_PACK";
        public const string StateEnvironmentVariable = "MCCRYSTAL_STATE";

        public static ContentPack Current { get; private set; } = CreateLegacy(Environment.CurrentDirectory);

        public ContentPackManifest Manifest { get; private init; }
        public string ManifestPath { get; private init; }
        public string ContentRoot { get; private init; }
        public string StateRoot { get; private init; }
        public string ConfigPath { get; private init; }
        public string EnvirPath { get; private init; }
        public string MapPath { get; private init; }
        public string DatabasePath { get; private init; }
        public bool IsLegacy { get; private init; }

        public static ContentPack Configure(string[] args)
        {
            var workingDirectory = Environment.CurrentDirectory;
            var packSelection = ReadOption(args, "--pack") ?? Environment.GetEnvironmentVariable(PackEnvironmentVariable);
            var stateSelection = ReadOption(args, "--state") ?? Environment.GetEnvironmentVariable(StateEnvironmentVariable);

            if (string.IsNullOrWhiteSpace(packSelection))
            {
                var defaultManifest = Path.Combine(workingDirectory, "packs", "classic", "pack.yaml");
                Current = File.Exists(defaultManifest)
                    ? Load(defaultManifest, stateSelection, workingDirectory)
                    : CreateLegacy(workingDirectory, stateSelection);
            }
            else
            {
                Current = Load(packSelection, stateSelection, workingDirectory);
            }

            return Current;
        }

        public static ContentPack Load(string selection, string stateSelection = null, string workingDirectory = null)
        {
            workingDirectory = Path.GetFullPath(workingDirectory ?? Environment.CurrentDirectory);
            var manifestPath = ResolveManifest(selection, workingDirectory);
            var deserializer = new DeserializerBuilder()
                .WithNamingConvention(CamelCaseNamingConvention.Instance)
                .IgnoreUnmatchedProperties()
                .Build();

            ContentPackManifest manifest;
            try
            {
                manifest = deserializer.Deserialize<ContentPackManifest>(File.ReadAllText(manifestPath));
            }
            catch (Exception ex) when (ex is IOException || ex is YamlDotNet.Core.YamlException)
            {
                throw new InvalidDataException($"Cannot read content pack manifest '{manifestPath}': {ex.Message}", ex);
            }

            if (manifest == null)
                throw new InvalidDataException($"Content pack manifest '{manifestPath}' is empty.");

            manifest.Paths ??= new ContentPackPaths();
            var manifestDirectory = Path.GetDirectoryName(manifestPath)!;
            var contentRoot = ResolvePath(manifestDirectory, manifest.ContentRoot, "contentRoot");
            var stateRoot = string.IsNullOrWhiteSpace(stateSelection)
                ? workingDirectory
                : ResolvePath(workingDirectory, stateSelection, "state");

            return new ContentPack
            {
                Manifest = manifest,
                ManifestPath = manifestPath,
                ContentRoot = contentRoot,
                StateRoot = stateRoot,
                ConfigPath = ResolvePath(contentRoot, manifest.Paths.Configs, "paths.configs"),
                EnvirPath = ResolvePath(contentRoot, manifest.Paths.Envir, "paths.envir"),
                MapPath = ResolvePath(contentRoot, manifest.Paths.Maps, "paths.maps"),
                DatabasePath = ResolvePath(contentRoot, manifest.Paths.Database, "paths.database")
            };
        }

        public void ValidateOrThrow(int minimumDatabaseSchema, int maximumDatabaseSchema)
        {
            if (IsLegacy)
                return;

            var errors = new List<string>();
            if (string.IsNullOrWhiteSpace(Manifest.Id)) errors.Add("id is required");
            if (string.IsNullOrWhiteSpace(Manifest.Version)) errors.Add("version is required");
            if (string.IsNullOrWhiteSpace(Manifest.Engine)) errors.Add("engine is required");
            RequireDirectory(ConfigPath, "configs", errors);
            RequireDirectory(EnvirPath, "envir", errors);
            RequireDirectory(MapPath, "maps", errors);

            if (!File.Exists(DatabasePath))
            {
                errors.Add($"database does not exist: {DatabasePath}");
            }
            else
            {
                try
                {
                    using var stream = File.OpenRead(DatabasePath);
                    using var reader = new BinaryReader(stream);
                    var actualSchema = reader.ReadInt32();
                    if (Manifest.DatabaseSchema != actualSchema)
                        errors.Add($"databaseSchema declares {Manifest.DatabaseSchema}, but Server.MirDB is {actualSchema}");
                    if (actualSchema < minimumDatabaseSchema || actualSchema > maximumDatabaseSchema)
                        errors.Add($"database schema {actualSchema} is outside engine range {minimumDatabaseSchema}-{maximumDatabaseSchema}");
                }
                catch (Exception ex) when (ex is IOException || ex is EndOfStreamException)
                {
                    errors.Add($"database header cannot be read: {ex.Message}");
                }
            }

            if (errors.Count > 0)
                throw new InvalidDataException($"Content pack '{Manifest.Id ?? ManifestPath}' is invalid:{Environment.NewLine}- {string.Join(Environment.NewLine + "- ", errors)}");

            Directory.CreateDirectory(StateRoot);
        }

        public string Describe() => IsLegacy
            ? $"legacy content at {ContentRoot}"
            : $"{Manifest.Id} {Manifest.Version} ({ContentRoot})";

        private static ContentPack CreateLegacy(string workingDirectory, string stateSelection = null)
        {
            var root = Path.GetFullPath(workingDirectory);
            var stateRoot = string.IsNullOrWhiteSpace(stateSelection)
                ? root
                : ResolvePath(root, stateSelection, "state");
            return new ContentPack
            {
                Manifest = new ContentPackManifest { Id = "legacy", Name = "Legacy directory layout", Version = "0" },
                ContentRoot = root,
                StateRoot = stateRoot,
                ConfigPath = Path.Combine(root, "Configs"),
                EnvirPath = Path.Combine(root, "Envir"),
                MapPath = Path.Combine(root, "Maps"),
                DatabasePath = Path.Combine(root, "Server.MirDB"),
                IsLegacy = true
            };
        }

        private static string ResolveManifest(string selection, string workingDirectory)
        {
            var candidate = Path.IsPathRooted(selection)
                ? selection
                : Path.Combine(workingDirectory, selection);

            if (!File.Exists(candidate) && !Directory.Exists(candidate) &&
                selection.IndexOf(Path.DirectorySeparatorChar) < 0 &&
                selection.IndexOf(Path.AltDirectorySeparatorChar) < 0)
                candidate = Path.Combine(workingDirectory, "packs", selection);

            if (Directory.Exists(candidate))
                candidate = Path.Combine(candidate, "pack.yaml");

            candidate = Path.GetFullPath(candidate);
            if (!File.Exists(candidate))
                throw new FileNotFoundException($"Content pack manifest was not found: {candidate}", candidate);
            return candidate;
        }

        private static string ResolvePath(string root, string value, string field)
        {
            if (string.IsNullOrWhiteSpace(value))
                throw new InvalidDataException($"Content pack field '{field}' cannot be empty.");
            return Path.GetFullPath(Path.IsPathRooted(value) ? value : Path.Combine(root, value));
        }

        private static string ReadOption(string[] args, string name)
        {
            for (var i = 0; i < args.Length; i++)
            {
                if (args[i].StartsWith(name + "=", StringComparison.Ordinal))
                    return args[i].Substring(name.Length + 1);
                if (args[i] == name)
                {
                    if (i + 1 >= args.Length)
                        throw new ArgumentException($"{name} requires a value.");
                    return args[i + 1];
                }
            }
            return null;
        }

        private static void RequireDirectory(string path, string name, List<string> errors)
        {
            if (!Directory.Exists(path)) errors.Add($"{name} directory does not exist: {path}");
        }
    }
}
