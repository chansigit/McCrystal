# Gameplay regression checks

Run from the repository root with the .NET 8 SDK:

```sh
dotnet run --project Tests/Regression/Regression.csproj
```

This executable uses the real Shared and Server assemblies without starting a
server or loading game resources. It returns a nonzero exit code on failure.
Checks cover packet framing and compression, inventory capacity, and trade
validation. A deterministic set of 500 inventory scenarios compares capacity
predictions against the production `AddItem` implementation and item conservation.
